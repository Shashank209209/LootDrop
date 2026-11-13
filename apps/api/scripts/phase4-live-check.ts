import { randomBytes, randomUUID } from 'node:crypto';
import pino from 'pino';
import type { DealSyncQuery } from '../src/pricing/contracts.js';
import type { JsonCache } from '../src/pricing/cache.js';
import type { CheapSharkDeal } from '../src/pricing/cheapshark/schemas.js';
import type { ZodType } from 'zod';
import { CheapSharkAdapter } from '../src/pricing/cheapshark/adapter.js';
import { runCheapSharkDealSync } from '../src/pricing/ingest-deals.js';
import { runAlertEvaluation } from '../src/alerts/evaluation-runner.js';
import { runAlertEmail } from '../src/alerts/email-runner.js';
import { createLogMailer } from '../src/alerts/mailer.js';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';

class MemoryCache implements JsonCache {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string, schema: ZodType<T>): Promise<T | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

type GameCandidate = {
  id: string;
  title: string;
  steamAppId: number | null;
  listings: Array<{
    id: string;
    storeId: string;
    storeGameId: string;
    currentPrice: { toNumber(): number };
    currency: string;
    store: { cheapsharkStoreId: string | null };
  }>;
};

function createAdapter(): CheapSharkAdapter {
  return new CheapSharkAdapter({
    cache: new MemoryCache(),
    limiter: { waitForPermit: async () => {} },
    userAgent: env.CHEAPSHARK_USER_AGENT,
  });
}

function printResult(label: string, status: number, body: unknown): void {
  if (status >= 500) throw new Error('An API request returned a server error');
  console.log(`${label} status=${status} json=${JSON.stringify(body)}`);
}

async function request(
  baseUrl: string,
  path: string,
  method: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed =
    response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>);
  return { status: response.status, body: parsed };
}

async function register(baseUrl: string, email: string, password: string) {
  const response = await request(baseUrl, '/auth/register', 'POST', undefined, {
    displayName: 'Phase 4 Check',
    email,
    password,
  });
  const user = response.body.user as { id: string } | undefined;
  const accessToken = response.body.accessToken;
  printResult('register', response.status, { registered: Boolean(user?.id) });
  if (response.status !== 201 || !user?.id || typeof accessToken !== 'string') {
    throw new Error('Throwaway registration failed');
  }
  return { userId: user.id, accessToken };
}

async function findGameAndDeal(): Promise<{
  game: GameCandidate;
  deal: CheapSharkDeal;
  storeId: string;
  currentPrice: number;
}> {
  const games = (await prisma.game.findMany({
    where: {
      steamAppId: { not: null },
      listings: { some: { currency: 'USD', store: { isActive: true } } },
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    take: 30,
    select: {
      id: true,
      title: true,
      steamAppId: true,
      listings: {
        where: { currency: 'USD', store: { isActive: true } },
        orderBy: [{ currentPrice: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          storeId: true,
          storeGameId: true,
          currentPrice: true,
          currency: true,
          store: { select: { cheapsharkStoreId: true } },
        },
      },
    },
  })) as GameCandidate[];

  for (const game of games) {
    if (game.steamAppId === null) continue;
    const response = await createAdapter().fetchDeals({
      pageNumber: 0,
      pageSize: 20,
      sortBy: 'DealRating',
      steamAppID: game.steamAppId,
    });
    const deal = response.items.find(
      (item) => item.steamAppID === String(game.steamAppId) && Number(item.salePrice) >= 0,
    );
    if (!deal) continue;
    const listing = game.listings.find(
      (candidate) =>
        candidate.store.cheapsharkStoreId === String(deal.storeID) &&
        candidate.storeGameId === String(deal.gameID),
    );
    if (!listing) continue;
    const currentPrice = listing.currentPrice.toNumber();
    return { game, deal, storeId: listing.storeId, currentPrice };
  }
  throw new Error('No existing USD listing matched a live CheapShark result');
}

async function main(): Promise<void> {
  if (env.EMAIL_PROVIDER !== 'log') throw new Error('EMAIL_PROVIDER must be log for this check');
  const gameSelection = await findGameAndDeal();
  const gamePriceCeiling = Math.max(
    ...gameSelection.game.listings.map((listing) => listing.currentPrice.toNumber()),
  );
  const targetPrice =
    Math.ceil((Math.max(gamePriceCeiling, Number(gameSelection.deal.salePrice)) + 1) * 100) / 100;
  if (targetPrice > 10_000) throw new Error("The selected game's price is outside alert limits");

  const email = `phase4-check-${randomUUID()}@example.invalid`;
  const secondEmail = `phase4-check-${randomUUID()}@example.invalid`;
  const password = `Phase4-${randomBytes(24).toString('hex')}`;
  const scrapeRunIds: string[] = [];
  const logLines: string[] = [];
  const logger = pino({ level: 'info' }, { write: (line) => logLines.push(line) });
  const mailer = createLogMailer(logger);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test API did not bind a port');
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  let firstUserId: string | undefined;
  let secondUserId: string | undefined;
  let cleanupIncomplete = false;

  const runSyncAndEvaluate = async () => {
    const query: DealSyncQuery = {
      pageNumber: 0,
      pageSize: 20,
      sortBy: 'DealRating',
      steamAppID: gameSelection.game.steamAppId!,
    };
    const sync = await runCheapSharkDealSync(query, {
      database: prisma,
      adapter: createAdapter(),
      logger,
      source: 'MANUAL',
      maxPages: 1,
    });
    scrapeRunIds.push(sync.scrapeRunId);
    console.log(
      `sync status=completed scrapeRunId=${sync.scrapeRunId} itemsProcessed=${sync.itemsProcessed} checkedListingIds=${sync.checkedListingIds.length}`,
    );
    const targetListing = await prisma.storeListing.findUnique({
      where: {
        storeId_storeGameId: {
          storeId: gameSelection.storeId,
          storeGameId: String(gameSelection.deal.gameID),
        },
      },
      select: { id: true },
    });
    if (!targetListing || !sync.checkedListingIds.includes(targetListing.id)) {
      throw new Error('Real sync did not return the target listing ID');
    }
    const evaluation = await runAlertEvaluation(
      { scrapeRunId: sync.scrapeRunId, listingIds: sync.checkedListingIds },
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
    console.log(`evaluation=${JSON.stringify(evaluation)}`);
    return sync;
  };

  try {
    const first = await register(baseUrl, email, password);
    firstUserId = first.userId;
    const created = await request(baseUrl, '/alerts', 'POST', first.accessToken, {
      gameId: gameSelection.game.id,
      storeId: gameSelection.storeId,
      currency: 'USD',
      alertType: 'PRICE_BELOW',
      targetPrice,
    });
    const alert = created.body as { id?: string };
    printResult('create-alert', created.status, {
      id: alert.id,
      alertType: 'PRICE_BELOW',
      targetPrice,
      currentPriceBeforeSync: gameSelection.currentPrice,
      gameTitle: gameSelection.game.title,
    });
    if (created.status !== 201 || !alert.id) throw new Error('Alert creation failed');
    const alertId = alert.id;

    await runSyncAndEvaluate();
    const initialNotifications = await prisma.notification.findMany({
      where: { userId: first.userId },
      select: { id: true, type: true, status: true },
    });
    const initialInApp = initialNotifications.filter((item) => item.type === 'IN_APP');
    const initialEmails = initialNotifications.filter((item) => item.type === 'EMAIL');
    if (initialInApp.length !== 1 || initialEmails.length !== 1) {
      throw new Error(
        'The first evaluation did not create exactly one in-app and one email record',
      );
    }
    const emailLog = logLines.filter(
      (line) => line.includes('Alert email suppressed') && line.includes('"recipient":"***"'),
    );
    if (emailLog.length !== 1) throw new Error('Expected exactly one masked log-provider line');
    console.log(`email-log=${emailLog[0]!.trim()}`);
    console.log(
      `notification-count after-first-evaluation: IN_APP=${initialInApp.length} EMAIL=${initialEmails.length}`,
    );

    await runSyncAndEvaluate();
    const secondCount = await prisma.notification.count({ where: { userId: first.userId } });
    if (secondCount !== 2) throw new Error('Second evaluation created a duplicate notification');
    console.log(`notification-count after-second-evaluation: total=${secondCount} duplicate=0`);

    const alerts = await request(baseUrl, '/alerts?page=1&pageSize=10', 'GET', first.accessToken);
    const alertData = alerts.body.data as Array<{ id: string; alertType: string }>;
    printResult('list-alerts', alerts.status, {
      data: alertData,
      pagination: alerts.body.pagination,
    });

    const notifications = await request(
      baseUrl,
      '/notifications?page=1&pageSize=10',
      'GET',
      first.accessToken,
    );
    const notificationData = notifications.body.data as Array<{
      id: string;
      type: string;
      status: string;
      message: string;
      priceAtTrigger: number;
      currency: string;
    }>;
    printResult('list-notifications', notifications.status, {
      data: notificationData,
      unreadCount: notifications.body.unreadCount,
    });
    const inApp = initialInApp[0];
    if (!inApp) throw new Error('In-app notification record was missing');
    const read = await request(
      baseUrl,
      `/notifications/${inApp.id}/read`,
      'PATCH',
      first.accessToken,
    );
    printResult('mark-read', read.status, read.body);
    const unread = await request(baseUrl, '/notifications/unread-count', 'GET', first.accessToken);
    printResult('unread-count', unread.status, unread.body);

    const patched = await request(baseUrl, `/alerts/${alertId}`, 'PATCH', first.accessToken, {
      isActive: false,
    });
    printResult('pause-alert', patched.status, {
      isActive: (patched.body as { isActive?: boolean }).isActive,
    });

    const second = await register(baseUrl, secondEmail, password);
    secondUserId = second.userId;
    const foreign = await request(baseUrl, `/alerts/${alertId}`, 'PATCH', second.accessToken, {
      isActive: false,
    });
    printResult('other-user-alert', foreign.status, foreign.body);
    if (foreign.status !== 404) throw new Error('A different user could access the alert');

    const deleted = await request(baseUrl, `/alerts/${alertId}`, 'DELETE', first.accessToken);
    printResult('delete-alert', deleted.status, {});
    if (deleted.status !== 204) throw new Error('Alert deletion failed');
  } finally {
    const userIds = [firstUserId, secondUserId].filter(
      (value): value is string => value !== undefined,
    );
    const [usersBefore, alertsBefore, notificationsBefore, refreshBefore, runsBefore] =
      await Promise.all([
        userIds.length ? prisma.user.count({ where: { id: { in: userIds } } }) : Promise.resolve(0),
        userIds.length
          ? prisma.priceAlert.count({ where: { userId: { in: userIds } } })
          : Promise.resolve(0),
        userIds.length
          ? prisma.notification.count({ where: { userId: { in: userIds } } })
          : Promise.resolve(0),
        userIds.length
          ? prisma.refreshToken.count({ where: { userId: { in: userIds } } })
          : Promise.resolve(0),
        scrapeRunIds.length
          ? prisma.scrapeRun.count({ where: { id: { in: scrapeRunIds } } })
          : Promise.resolve(0),
      ]);
    console.log(
      `cleanup-before: users=${usersBefore} alerts=${alertsBefore} notifications=${notificationsBefore} refreshTokens=${refreshBefore} scrapeRuns=${runsBefore}`,
    );
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (scrapeRunIds.length) {
      await prisma.scrapeRun.deleteMany({ where: { id: { in: scrapeRunIds } } });
    }
    const [usersAfter, alertsAfter, notificationsAfter, refreshAfter, runsAfter] =
      await Promise.all([
        userIds.length ? prisma.user.count({ where: { id: { in: userIds } } }) : Promise.resolve(0),
        userIds.length
          ? prisma.priceAlert.count({ where: { userId: { in: userIds } } })
          : Promise.resolve(0),
        userIds.length
          ? prisma.notification.count({ where: { userId: { in: userIds } } })
          : Promise.resolve(0),
        userIds.length
          ? prisma.refreshToken.count({ where: { userId: { in: userIds } } })
          : Promise.resolve(0),
        scrapeRunIds.length
          ? prisma.scrapeRun.count({ where: { id: { in: scrapeRunIds } } })
          : Promise.resolve(0),
      ]);
    console.log(
      `cleanup-after: users=${usersAfter} alerts=${alertsAfter} notifications=${notificationsAfter} refreshTokens=${refreshAfter} scrapeRuns=${runsAfter}`,
    );
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await prisma.$disconnect();
    cleanupIncomplete = [usersAfter, alertsAfter, notificationsAfter, refreshAfter, runsAfter].some(
      (count) => count !== 0,
    );
  }
  if (cleanupIncomplete) throw new Error('Throwaway cleanup was incomplete');
}

main().catch((error: unknown) => {
  console.error(
    `Phase 4 live check failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
  );
  process.exitCode = 1;
});
