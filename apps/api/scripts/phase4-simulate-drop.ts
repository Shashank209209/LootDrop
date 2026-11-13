import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { Prisma } from '@prisma/client';
import { runAlertEvaluation } from '../src/alerts/evaluation-runner.js';
import { runAlertEmail } from '../src/alerts/email-runner.js';
import { createLogMailer } from '../src/alerts/mailer.js';
import { prisma } from '../src/db/prisma.js';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The simulator refuses to run in production');
  }
  if (process.env.PHASE4_TEST_GUARD !== '1') {
    throw new Error('Run this command through scripts/phase4-test-guard.mjs');
  }
  if (process.env.EMAIL_PROVIDER !== 'log') {
    throw new Error('EMAIL_PROVIDER must be log');
  }

  const alertId = argument('--alert');
  const price = Number(argument('--price'));
  if (!Number.isFinite(price) || price < 0) throw new Error('Price must be a non-negative number');

  const alert = await prisma.priceAlert.findUnique({
    where: { id: alertId },
    select: {
      id: true,
      userId: true,
      gameId: true,
      storeId: true,
      currency: true,
      alertType: true,
      targetPrice: true,
      isActive: true,
      lastConditionMet: true,
      user: { select: { email: true } },
    },
  });
  if (
    !alert ||
    !/^phase4-(?:check|sim)-[a-z0-9-]+@example\.invalid$/i.test(alert.user.email) ||
    alert.alertType !== 'PRICE_BELOW' ||
    !alert.isActive ||
    alert.storeId === null ||
    alert.targetPrice === null ||
    alert.lastConditionMet === true
  ) {
    throw new Error('Alert must be an active, store-scoped throwaway PRICE_BELOW alert');
  }

  const listings = await prisma.storeListing.findMany({
    where: {
      gameId: alert.gameId,
      storeId: alert.storeId,
      currency: alert.currency,
      store: { isActive: true },
    },
    select: { id: true, gameId: true, storeId: true, currentPrice: true, currency: true },
  });
  if (listings.length !== 1) throw new Error('The alert must match exactly one active listing');
  const listing = listings[0]!;
  if (
    listing.gameId !== alert.gameId ||
    listing.storeId !== alert.storeId ||
    listing.currency !== alert.currency
  ) {
    throw new Error('The listing does not match the alert game, store, and currency');
  }

  const otherActiveAlerts = await prisma.priceAlert.findMany({
    where: {
      gameId: alert.gameId,
      currency: alert.currency,
      isActive: true,
      OR: [{ storeId: null }, { storeId: listing.storeId }],
    },
    select: { id: true },
  });
  if (otherActiveAlerts.length !== 1 || otherActiveAlerts[0]?.id !== alert.id) {
    throw new Error('The listing has other active matching alerts; refusing to affect them');
  }

  const originalPrice = listing.currentPrice;
  const targetPrice = new Prisma.Decimal(alert.targetPrice);
  const simulatedPrice = new Prisma.Decimal(price);
  if (
    originalPrice.lte(targetPrice) ||
    simulatedPrice.gte(originalPrice) ||
    simulatedPrice.gt(targetPrice)
  ) {
    throw new Error(
      'Simulated price must be lower than the current price and at or below the target',
    );
  }

  const logger = pino({ level: 'info' });
  const mailer = createLogMailer(logger);
  try {
    await prisma.storeListing.update({
      where: { id: listing.id },
      data: { currentPrice: simulatedPrice },
    });
    const result = await runAlertEvaluation(
      { scrapeRunId: randomUUID(), listingIds: [listing.id] },
      {
        database: prisma,
        logger,
        queueEmail: (notificationId) =>
          runAlertEmail(notificationId, {
            database: prisma,
            mailer,
            logger,
            attemptsMade: 0,
            maxAttempts: 3,
          }),
      },
    );
    if (result.fired !== 1 || result.failed !== 0) {
      throw new Error('The named alert did not fire exactly once');
    }
    console.log(`simulated alert=${alert.id} listing=${listing.id} fired=${result.fired}`);
  } finally {
    await prisma.storeListing.update({
      where: { id: listing.id },
      data: { currentPrice: originalPrice },
    });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Phase 4 simulator failed: ${error instanceof Error ? error.message : 'UnknownError'}`,
  );
  process.exitCode = 1;
});
