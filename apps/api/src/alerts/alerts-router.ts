import { Prisma, type PrismaClient } from '@prisma/client';
import {
  alertsQuerySchema,
  createAlertRequestSchema,
  updateAlertRequestSchema,
} from '@dealhunter/contracts';
import { Router, type Request, type Response } from 'express';
import { createRequireAuth } from '../auth/require-auth.js';
import { sendApiError } from '../http/api-error.js';
import { moneyNumber } from '../pricing/deal-serialization.js';

type AlertsDatabase = Pick<
  PrismaClient,
  '$transaction' | 'game' | 'priceAlert' | 'store' | 'storeListing'
>;

const alertSelect = {
  id: true,
  gameId: true,
  storeId: true,
  alertType: true,
  targetPrice: true,
  targetDiscountPercent: true,
  currency: true,
  isActive: true,
  lastTriggeredAt: true,
  createdAt: true,
  game: { select: { id: true, slug: true, title: true } },
  store: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.PriceAlertSelect;

const listingSelect = {
  id: true,
  gameId: true,
  storeId: true,
  currentPrice: true,
  regularPrice: true,
  discountPercent: true,
  currency: true,
  store: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.StoreListingSelect;

type AlertRecord = Prisma.PriceAlertGetPayload<{ select: typeof alertSelect }>;
type ListingRecord = Prisma.StoreListingGetPayload<{ select: typeof listingSelect }>;

function getUserId(response: Response): string | null {
  const userId: unknown = response.locals.userId;
  return typeof userId === 'string' ? userId : null;
}

function parseQuery(request: Request) {
  const searchParams = new URL(request.originalUrl, 'http://localhost').searchParams;
  const raw: Record<string, string> = {};
  for (const key of new Set(searchParams.keys())) {
    if (key !== 'page' && key !== 'pageSize') {
      return { success: false as const, message: `Unknown query parameter: ${key}` };
    }
    const values = searchParams.getAll(key);
    if (values.length !== 1) {
      return {
        success: false as const,
        message: `Query parameter "${key}" may only be specified once`,
      };
    }
    const value = values[0];
    if (value !== undefined) raw[key] = value;
  }
  const parsed = alertsQuerySchema.safeParse(raw);
  return parsed.success
    ? parsed
    : {
        success: false as const,
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      };
}

function serializeAlert(alert: AlertRecord, listings: readonly ListingRecord[]) {
  const candidates = listings.filter(
    (listing) =>
      listing.gameId === alert.gameId &&
      listing.currency === alert.currency &&
      (alert.storeId === null || listing.storeId === alert.storeId),
  );
  candidates.sort(
    (left, right) =>
      left.currentPrice.comparedTo(right.currentPrice) || left.id.localeCompare(right.id),
  );
  const current = candidates[0];
  return {
    id: alert.id,
    game: alert.game,
    store: alert.store,
    alertType: alert.alertType,
    targetPrice: moneyNumber(alert.targetPrice),
    targetDiscountPercent: alert.targetDiscountPercent,
    currency: alert.currency,
    isActive: alert.isActive,
    lastTriggeredAt: alert.lastTriggeredAt?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString(),
    current: current
      ? {
          currentPrice: moneyNumber(current.currentPrice) ?? 0,
          regularPrice: moneyNumber(current.regularPrice),
          discountPercent: current.discountPercent,
          currency: current.currency,
          store: current.store,
        }
      : null,
  };
}

async function serializeAlerts(database: AlertsDatabase, alerts: readonly AlertRecord[]) {
  if (alerts.length === 0) return [];
  const listings = await database.storeListing.findMany({
    where: {
      gameId: { in: [...new Set(alerts.map((alert) => alert.gameId))] },
      currency: { in: [...new Set(alerts.map((alert) => alert.currency))] },
      store: { isActive: true },
    },
    select: listingSelect,
  });
  return alerts.map((alert) => serializeAlert(alert, listings));
}

function validateUpdateType(
  alertType: AlertRecord['alertType'],
  input: {
    targetPrice?: number | undefined;
    targetDiscountPercent?: number | undefined;
  },
): boolean {
  if (input.targetPrice !== undefined && alertType !== 'PRICE_BELOW') return false;
  if (input.targetDiscountPercent !== undefined && alertType !== 'DISCOUNT_ABOVE') return false;
  return true;
}

export function createAlertsRouter(
  database: AlertsDatabase,
  accessSecret: string,
  issuer: string,
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(accessSecret, issuer);

  router.get('/alerts', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const parsed = parseQuery(request);
    if (!parsed.success) {
      sendApiError(response, 400, 'INVALID_QUERY', parsed.message);
      return;
    }
    const { page, pageSize } = parsed.data;
    const where = { userId };
    try {
      const [totalItems, records] = await database.$transaction(async (transaction) =>
        Promise.all([
          transaction.priceAlert.count({ where }),
          transaction.priceAlert.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: alertSelect,
          }),
        ]),
      );
      const data = await serializeAlerts(database, records);
      const totalPages = Math.ceil(totalItems / pageSize);
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({
        data,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasNextPage: page < totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/alerts', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const parsed = createAlertRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendApiError(
        response,
        400,
        'INVALID_REQUEST',
        parsed.error.issues.map((issue) => issue.message).join('; '),
      );
      return;
    }
    try {
      const game = await database.game.findUnique({
        where: { id: parsed.data.gameId },
        select: { id: true },
      });
      if (!game) {
        sendApiError(response, 404, 'NOT_FOUND', 'Game not found');
        return;
      }
      if (parsed.data.storeId) {
        const store = await database.store.findUnique({
          where: { id: parsed.data.storeId },
          select: { id: true, isActive: true },
        });
        if (!store || !store.isActive) {
          sendApiError(response, 404, 'NOT_FOUND', 'Store not found');
          return;
        }
      }

      const targetPrice =
        'targetPrice' in parsed.data ? new Prisma.Decimal(parsed.data.targetPrice) : null;
      const targetDiscountPercent =
        'targetDiscountPercent' in parsed.data ? parsed.data.targetDiscountPercent : null;
      const identity = {
        userId,
        gameId: parsed.data.gameId,
        storeId: parsed.data.storeId ?? null,
        alertType: parsed.data.alertType,
        targetPrice,
        targetDiscountPercent,
        currency: parsed.data.currency,
      };
      const record = await database.$transaction(async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext('lootdrop-alert-limit'))`,
        );
        if (await transaction.priceAlert.findFirst({ where: identity, select: { id: true } })) {
          return { conflict: 'duplicate' as const };
        }
        if ((await transaction.priceAlert.count({ where: { userId } })) >= 50) {
          return { conflict: 'limit' as const };
        }
        const alert = await transaction.priceAlert.create({
          data: identity,
          select: alertSelect,
        });
        return { alert };
      });
      if ('conflict' in record) {
        sendApiError(
          response,
          409,
          record.conflict === 'duplicate' ? 'DUPLICATE_ALERT' : 'ALERT_LIMIT_REACHED',
          record.conflict === 'duplicate' ? 'This alert already exists' : 'Alert limit reached',
        );
        return;
      }
      const [data] = await serializeAlerts(database, [record.alert]);
      response.setHeader('Cache-Control', 'no-store');
      response.status(201).json(data);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/alerts/:alertId', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const alertId = request.params.alertId;
    if (typeof alertId !== 'string' || !/^[0-9a-f-]{36}$/i.test(alertId)) {
      sendApiError(response, 400, 'INVALID_REQUEST', 'alertId must be a UUID');
      return;
    }
    const parsed = updateAlertRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendApiError(
        response,
        400,
        'INVALID_REQUEST',
        parsed.error.issues.map((issue) => issue.message).join('; '),
      );
      return;
    }
    try {
      const existing = await database.priceAlert.findFirst({
        where: { id: alertId, userId },
        select: alertSelect,
      });
      if (!existing) {
        sendApiError(response, 404, 'NOT_FOUND', 'Alert not found');
        return;
      }
      if (!validateUpdateType(existing.alertType, parsed.data)) {
        sendApiError(response, 400, 'INVALID_REQUEST', 'Fields do not match this alert type');
        return;
      }

      const nextIdentity = {
        userId,
        gameId: existing.gameId,
        storeId: existing.storeId,
        alertType: existing.alertType,
        targetPrice:
          parsed.data.targetPrice === undefined
            ? existing.targetPrice
            : new Prisma.Decimal(parsed.data.targetPrice),
        targetDiscountPercent:
          parsed.data.targetDiscountPercent === undefined
            ? existing.targetDiscountPercent
            : parsed.data.targetDiscountPercent,
        currency: existing.currency,
      };
      const duplicate = await database.priceAlert.findFirst({
        where: { ...nextIdentity, id: { not: existing.id } },
        select: { id: true },
      });
      if (duplicate) {
        sendApiError(response, 409, 'DUPLICATE_ALERT', 'This alert already exists');
        return;
      }
      const updateData: Prisma.PriceAlertUpdateInput = {
        ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
        ...(parsed.data.targetPrice === undefined
          ? {}
          : { targetPrice: new Prisma.Decimal(parsed.data.targetPrice) }),
        ...(parsed.data.targetDiscountPercent === undefined
          ? {}
          : { targetDiscountPercent: parsed.data.targetDiscountPercent }),
      };
      const updated = await database.priceAlert.update({
        where: { id: existing.id },
        data: updateData,
        select: alertSelect,
      });
      const [data] = await serializeAlerts(database, [updated]);
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json(data);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/alerts/:alertId', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const alertId = request.params.alertId;
    if (typeof alertId !== 'string' || !/^[0-9a-f-]{36}$/i.test(alertId)) {
      sendApiError(response, 400, 'INVALID_REQUEST', 'alertId must be a UUID');
      return;
    }
    try {
      const deleted = await database.priceAlert.deleteMany({ where: { id: alertId, userId } });
      if (deleted.count === 0) {
        sendApiError(response, 404, 'NOT_FOUND', 'Alert not found');
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
