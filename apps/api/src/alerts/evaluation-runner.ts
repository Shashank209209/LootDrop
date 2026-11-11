import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { moneyNumber } from '../pricing/deal-serialization.js';
import {
  evaluateAlerts,
  type AlertToEvaluate,
  type ListingToEvaluate,
  type SnapshotToEvaluate,
} from './evaluator.js';

const alertSelect = {
  id: true,
  userId: true,
  gameId: true,
  storeId: true,
  alertType: true,
  targetPrice: true,
  targetDiscountPercent: true,
  currency: true,
  isActive: true,
  lastTriggeredAt: true,
  user: { select: { email: true } },
  game: { select: { slug: true, title: true } },
} satisfies Prisma.PriceAlertSelect;

const listingSelect = {
  id: true,
  gameId: true,
  storeId: true,
  currentPrice: true,
  regularPrice: true,
  discountPercent: true,
  currency: true,
  isOnSale: true,
  lastCheckedAt: true,
  store: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.StoreListingSelect;

type AlertRecord = Prisma.PriceAlertGetPayload<{ select: typeof alertSelect }>;
type ListingRecord = Prisma.StoreListingGetPayload<{ select: typeof listingSelect }>;

type AlertConditionState = {
  id: string;
  lastConditionMet: boolean | null;
};

type AlertEvaluationDatabase = Pick<
  PrismaClient,
  | '$executeRaw'
  | '$queryRaw'
  | '$transaction'
  | 'priceAlert'
  | 'priceSnapshot'
  | 'storeListing'
  | 'notification'
>;

type AlertEvaluationResult = {
  evaluated: number;
  fired: number;
  emailsQueued: number;
  emailsCapped: number;
  failed: number;
};

function toListing(listing: ListingRecord): ListingToEvaluate {
  return {
    id: listing.id,
    gameId: listing.gameId,
    storeId: listing.storeId,
    currentPrice: moneyNumber(listing.currentPrice) ?? 0,
    regularPrice: moneyNumber(listing.regularPrice),
    discountPercent: listing.discountPercent,
    currency: listing.currency,
    isOnSale: listing.isOnSale,
    lastCheckedAt: listing.lastCheckedAt,
  };
}

function toAlert(record: AlertRecord, lastConditionMet: boolean | null): AlertToEvaluate {
  return {
    id: record.id,
    gameId: record.gameId,
    storeId: record.storeId,
    alertType: record.alertType,
    targetPrice: moneyNumber(record.targetPrice),
    targetDiscountPercent: record.targetDiscountPercent,
    currency: record.currency,
    isActive: record.isActive,
    lastTriggeredAt: record.lastTriggeredAt,
    lastConditionMet,
  };
}

function alertMessage(alert: AlertRecord, listing: ListingRecord): string {
  const price = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: listing.currency,
  }).format(moneyNumber(listing.currentPrice) ?? 0);
  return `${alert.game.title} is now ${price} at ${listing.store.name}.`;
}

export async function runAlertEvaluation(
  input: { scrapeRunId: string; listingIds: string[] },
  dependencies: {
    database: AlertEvaluationDatabase;
    queueEmail: (notificationId: string) => Promise<void>;
    logger: Logger;
    now?: Date;
  },
): Promise<AlertEvaluationResult> {
  const { database, queueEmail, logger, now = new Date() } = dependencies;
  const changedListings = await database.storeListing.findMany({
    where: { id: { in: input.listingIds }, store: { isActive: true } },
    select: listingSelect,
  });
  if (changedListings.length === 0) {
    return { evaluated: 0, fired: 0, emailsQueued: 0, emailsCapped: 0, failed: 0 };
  }

  const gameIds = [...new Set(changedListings.map((listing) => listing.gameId))];
  const [listings, alertRecords] = await Promise.all([
    database.storeListing.findMany({
      where: { gameId: { in: gameIds }, store: { isActive: true } },
      select: listingSelect,
    }),
    database.priceAlert.findMany({
      where: { isActive: true, gameId: { in: gameIds } },
      select: alertSelect,
    }),
  ]);
  if (alertRecords.length === 0) {
    return { evaluated: 0, fired: 0, emailsQueued: 0, emailsCapped: 0, failed: 0 };
  }

  const listingIds = [...new Set(listings.map((listing) => listing.id))];
  const alertIds = alertRecords.map((alert) => alert.id);
  const [snapshotGroups, conditionStates] = await Promise.all([
    database.priceSnapshot.groupBy({
      by: ['listingId', 'currency'],
      where: { listingId: { in: listingIds } },
      _count: { _all: true },
      _min: { price: true },
    }),
    database.$queryRaw<AlertConditionState[]>(
      Prisma.sql`SELECT id, last_condition_met AS "lastConditionMet" FROM price_alerts WHERE id IN (${Prisma.join(
        alertIds.map((id) => Prisma.sql`${id}::uuid`),
      )})`,
    ),
  ]);
  const stateByAlertId = new Map(
    conditionStates.map((state) => [state.id, state.lastConditionMet]),
  );
  const snapshotSummaries: SnapshotToEvaluate[] = snapshotGroups.flatMap((group) => {
    const lowestPrice = moneyNumber(group._min.price);
    if (lowestPrice === null) return [];
    return [
      {
        listingId: group.listingId,
        currency: group.currency,
        count: group._count._all,
        lowestPrice,
      },
    ];
  });
  const alertById = new Map(alertRecords.map((record) => [record.id, record]));
  const listingById = new Map(listings.map((record) => [record.id, record]));
  const evaluation = evaluateAlerts({
    alerts: alertRecords.map((record) => toAlert(record, stateByAlertId.get(record.id) ?? null)),
    listings: listings.map(toListing),
    snapshots: snapshotSummaries,
    changedListingIds: changedListings.map((listing) => listing.id),
    now,
  });

  let fired = 0;
  let emailsQueued = 0;
  let emailsCapped = 0;
  let failed = 0;

  for (const stateUpdate of evaluation.stateUpdates) {
    const record = alertById.get(stateUpdate.alertId);
    if (!record) continue;
    if (stateUpdate.previousConditionMet === stateUpdate.conditionMet && !stateUpdate.shouldFire) {
      continue;
    }

    const firedListing = evaluation.fired.find(
      (candidate) => candidate.alert.id === stateUpdate.alertId,
    );
    const listingRecord = firedListing ? listingById.get(firedListing.listing.id) : undefined;
    try {
      if (!stateUpdate.shouldFire || !firedListing || !listingRecord) {
        await database.$executeRaw(
          Prisma.sql`UPDATE price_alerts SET last_condition_met = ${stateUpdate.conditionMet} WHERE id = ${stateUpdate.alertId}::uuid AND last_condition_met IS NOT DISTINCT FROM ${stateUpdate.previousConditionMet}::boolean`,
        );
        continue;
      }

      const summary = alertMessage(record, listingRecord);
      const transactionResult = await database.$transaction(async (transaction) => {
        const updated = await transaction.$executeRaw(
          Prisma.sql`UPDATE price_alerts SET last_condition_met = TRUE, last_triggered_at = ${now}::timestamptz WHERE id = ${stateUpdate.alertId}::uuid AND last_condition_met IS NOT DISTINCT FROM ${stateUpdate.previousConditionMet}::boolean`,
        );
        if (updated !== 1) return { kind: 'duplicate' as const };

        const priceAtTrigger = new Prisma.Decimal(moneyNumber(listingRecord.currentPrice) ?? 0);
        await transaction.notification.create({
          data: {
            userId: record.userId,
            alertId: record.id,
            listingId: listingRecord.id,
            type: 'IN_APP',
            status: 'SENT',
            message: summary,
            priceAtTrigger,
          },
        });

        await transaction.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${record.userId}), hashtext('lootdrop-alert-email-cap'))`,
        );
        const emailCount = await transaction.notification.count({
          where: {
            userId: record.userId,
            type: 'EMAIL',
            status: { in: ['PENDING', 'SENT'] },
            createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
        });
        const capped = emailCount >= 20;
        const emailNotification = await transaction.notification.create({
          data: {
            userId: record.userId,
            alertId: record.id,
            listingId: listingRecord.id,
            type: 'EMAIL',
            status: capped ? 'FAILED' : 'PENDING',
            message: capped ? 'Email daily limit reached' : summary,
            priceAtTrigger,
          },
          select: { id: true },
        });
        return { kind: 'created' as const, emailId: emailNotification.id, capped };
      });

      if (transactionResult.kind === 'duplicate') continue;
      fired += 1;
      if (transactionResult.capped) {
        emailsCapped += 1;
        continue;
      }
      try {
        await queueEmail(transactionResult.emailId);
        emailsQueued += 1;
      } catch (error) {
        failed += 1;
        await database.notification.updateMany({
          where: { id: transactionResult.emailId, status: 'PENDING' },
          data: { status: 'FAILED', message: 'Email could not be queued' },
        });
        logger.error(
          {
            alertId: record.id,
            notificationId: transactionResult.emailId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'Could not enqueue alert email',
        );
      }
    } catch (error) {
      failed += 1;
      logger.error(
        {
          alertId: record.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Alert evaluation failed for one alert',
      );
    }
  }

  const result = {
    evaluated: evaluation.evaluated,
    fired,
    emailsQueued,
    emailsCapped,
    failed,
  };
  logger.info({ scrapeRunId: input.scrapeRunId, ...result }, 'Alert evaluation finished');
  return result;
}
