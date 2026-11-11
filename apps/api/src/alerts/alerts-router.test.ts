import { Prisma, type PrismaClient } from '@prisma/client';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../auth/jwt.js';
import { createAlertsRouter } from './alerts-router.js';

const accessSecret = 'alerts-test-secret-longer-than-thirty-two-characters';
const issuer = 'alerts-test';
const userA = '20da2e1d-c56e-4874-8e7c-f5d15d38d502';
const userB = '5e3b8681-16bb-4a40-8b5a-836a4546a02e';
const gameId = '35e98245-82b3-4fef-a482-6d3c89e97e29';
const storeId = '0e01582f-3fbe-49e3-ab5a-e4e40d30e4a3';
const alertId = '1c492956-9e90-4c46-ab66-3c28475a11d6';
const servers: Array<ReturnType<express.Express['listen']>> = [];

function createTestApi(options: { alertCount?: number; ownedBy?: string } = {}) {
  const alerts = new Map([
    [
      alertId,
      {
        id: alertId,
        userId: options.ownedBy ?? userA,
        gameId,
        storeId: null,
        alertType: 'PRICE_BELOW' as const,
        targetPrice: new Prisma.Decimal('10.00'),
        targetDiscountPercent: null,
        currency: 'USD',
        isActive: true,
        lastTriggeredAt: null,
        createdAt: new Date('2026-11-11T12:00:00.000Z'),
        game: { id: gameId, slug: 'test-game', title: 'Test Game' },
        store: null,
      },
    ],
  ]);
  const transaction = {
    $queryRaw: vi.fn(async () => []),
    game: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === gameId ? { id: gameId } : null,
      ),
    },
    store: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === storeId ? { id: storeId, isActive: true } : null,
      ),
    },
    priceAlert: {
      count: vi.fn(
        async ({ where }: { where: { userId: string } }) =>
          options.alertCount ??
          [...alerts.values()].filter((alert) => alert.userId === where.userId).length,
      ),
      findMany: vi.fn(
        async ({ where, skip, take }: { where: { userId: string }; skip: number; take: number }) =>
          [...alerts.values()]
            .filter((alert) => alert.userId === where.userId)
            .slice(skip, skip + take),
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            id?: string | { not: string };
            userId?: string;
            gameId?: string;
            storeId?: string | null;
            alertType?: string;
            targetPrice?: Prisma.Decimal | null;
            targetDiscountPercent?: number | null;
            currency?: string;
          };
        }) => {
          if (typeof where.id === 'string') {
            const alert = alerts.get(where.id);
            return alert?.userId === where.userId ? alert : null;
          }
          if (where.id !== undefined) return null;
          if (where.userId !== undefined && where.gameId !== undefined) {
            return (
              [...alerts.values()].find(
                (alert) =>
                  alert.userId === where.userId &&
                  alert.gameId === where.gameId &&
                  alert.storeId === where.storeId &&
                  alert.alertType === where.alertType &&
                  (alert.targetPrice === null
                    ? where.targetPrice === null
                    : where.targetPrice instanceof Prisma.Decimal &&
                      alert.targetPrice.equals(where.targetPrice)) &&
                  alert.targetDiscountPercent === where.targetDiscountPercent &&
                  alert.currency === where.currency,
              ) ?? null
            );
          }
          return null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const alert = {
          id: '2c492956-9e90-4c46-ab66-3c28475a11d7',
          ...data,
          isActive: true,
          lastTriggeredAt: null,
          createdAt: new Date('2026-11-11T12:00:00.000Z'),
          game: { id: gameId, slug: 'test-game', title: 'Test Game' },
          store: null,
        };
        alerts.set(alert.id, alert as typeof alerts extends Map<string, infer T> ? T : never);
        return alert;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...alerts.get(alertId)!,
        ...data,
      })),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => ({
        count: alerts.get(where.id)?.userId === where.userId ? Number(alerts.delete(where.id)) : 0,
      })),
    },
    storeListing: {
      findMany: vi.fn(async () => [
        {
          id: '3c492956-9e90-4c46-ab66-3c28475a11d8',
          gameId,
          storeId,
          currentPrice: new Prisma.Decimal('9.25'),
          regularPrice: new Prisma.Decimal('20.00'),
          discountPercent: 54,
          currency: 'USD',
          store: { id: storeId, name: 'Example Store', slug: 'example-store' },
        },
      ]),
    },
  };
  const database = {
    ...transaction,
    $transaction: vi.fn(async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createAlertsRouter(database, accessSecret, issuer));
  app.use(
    (
      _error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      response.status(500).json({ error: { code: 'TEST_ERROR', message: 'Test request failed' } });
    },
  );
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');

  return {
    alerts,
    transaction,
    request: (userId: string, method: string, path: string, body?: unknown) =>
      fetch(`http://127.0.0.1:${address.port}/api/v1/alerts${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${signAccessToken(userId, accessSecret, issuer)}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    anonymousRequest: () => fetch(`http://127.0.0.1:${address.port}/api/v1/alerts`),
  };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe('alert routes', () => {
  it('requires authentication and paginates with current prices', async () => {
    const api = createTestApi();
    expect((await api.anonymousRequest()).status).toBe(401);

    const response = await api.request(userA, 'GET', '?page=1&pageSize=1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: alertId, current: { currentPrice: 9.25, currency: 'USD' } }],
      pagination: { page: 1, pageSize: 1, totalItems: 1 },
    });
    expect((await api.request(userA, 'GET', '?pageSize=51')).status).toBe(400);
  });

  it('creates valid alerts, returns current price, and rejects exact duplicates', async () => {
    const api = createTestApi({ alertCount: 0 });
    const input = {
      gameId,
      alertType: 'PRICE_BELOW',
      targetPrice: 9,
      currency: 'USD',
    };
    const created = await api.request(userA, 'POST', '', input);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      alertType: 'PRICE_BELOW',
      current: { currentPrice: 9.25 },
    });
    expect((await api.request(userA, 'POST', '', input)).status).toBe(409);
  });

  it('validates alert type fields, unknown games, stores, duplicates and the user limit', async () => {
    const api = createTestApi({ alertCount: 0 });
    expect(
      (
        await api.request(userA, 'POST', '', {
          gameId,
          alertType: 'PRICE_BELOW',
          targetDiscountPercent: 20,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api.request(userA, 'POST', '', {
          gameId: '4c492956-9e90-4c46-ab66-3c28475a11d9',
          alertType: 'ANY_SALE',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api.request(userA, 'POST', '', {
          gameId,
          storeId: '4c492956-9e90-4c46-ab66-3c28475a11d9',
          alertType: 'ANY_SALE',
        })
      ).status,
    ).toBe(404);

    const full = createTestApi({ alertCount: 50 });
    expect(
      (
        await full.request(userA, 'POST', '', {
          gameId,
          alertType: 'ANY_SALE',
        })
      ).status,
    ).toBe(409);
  });

  it('only updates and deletes owned alerts and validates patch fields for the alert type', async () => {
    const api = createTestApi();
    expect((await api.request(userB, 'PATCH', `/${alertId}`, { isActive: false })).status).toBe(
      404,
    );
    expect(
      (
        await api.request(userA, 'PATCH', `/${alertId}`, {
          targetDiscountPercent: 40,
        })
      ).status,
    ).toBe(400);
    expect((await api.request(userB, 'DELETE', `/${alertId}`)).status).toBe(404);
    expect((await api.request(userA, 'DELETE', `/${alertId}`)).status).toBe(204);
  });
});
