import { Prisma, type PrismaClient } from '@prisma/client';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../auth/jwt.js';
import { createNotificationsRouter } from './notifications-router.js';

const accessSecret = 'notifications-test-secret-longer-than-thirty-two-characters';
const issuer = 'notifications-test';
const userA = '20da2e1d-c56e-4874-8e7c-f5d15d38d502';
const userB = '5e3b8681-16bb-4a40-8b5a-836a4546a02e';
const notificationA = '1c492956-9e90-4c46-ab66-3c28475a11d6';
const notificationB = '2c492956-9e90-4c46-ab66-3c28475a11d7';
const servers: Array<ReturnType<express.Express['listen']>> = [];

function createTestApi() {
  const notifications = new Map([
    [
      notificationA,
      {
        id: notificationA,
        userId: userA,
        type: 'IN_APP' as const,
        status: 'SENT' as const,
        message: 'Test Game dropped in price',
        priceAtTrigger: new Prisma.Decimal('9.25'),
        readAt: null as Date | null,
        createdAt: new Date('2026-11-11T12:00:00.000Z'),
        listing: {
          currency: 'USD',
          store: { name: 'Example Store' },
        },
        alert: { game: { slug: 'test-game', title: 'Test Game' } },
      },
    ],
    [
      notificationB,
      {
        id: notificationB,
        userId: userB,
        type: 'IN_APP' as const,
        status: 'SENT' as const,
        message: 'Private notification',
        priceAtTrigger: new Prisma.Decimal('5.00'),
        readAt: null as Date | null,
        createdAt: new Date('2026-11-11T13:00:00.000Z'),
        listing: {
          currency: 'USD',
          store: { name: 'Other Store' },
        },
        alert: { game: { slug: 'other-game', title: 'Other Game' } },
      },
    ],
  ]);
  const notification = {
    count: vi.fn(
      async ({ where }: { where: { userId: string; readAt?: null } }) =>
        [...notifications.values()].filter(
          (entry) =>
            entry.userId === where.userId && (where.readAt !== null || entry.readAt === null),
        ).length,
    ),
    findMany: vi.fn(
      async ({
        where,
        skip,
        take,
      }: {
        where: { userId: string; readAt?: null };
        skip: number;
        take: number;
      }) =>
        [...notifications.values()]
          .filter(
            (entry) =>
              entry.userId === where.userId && (where.readAt !== null || entry.readAt === null),
          )
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .slice(skip, skip + take),
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: string; userId: string; readAt?: null };
        data: { readAt: Date };
      }) => {
        let count = 0;
        for (const entry of notifications.values()) {
          if (
            entry.userId === where.userId &&
            (where.id === undefined || entry.id === where.id) &&
            (where.readAt !== null || entry.readAt === null)
          ) {
            entry.readAt = data.readAt;
            count += 1;
          }
        }
        return { count };
      },
    ),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const entry = notifications.get(where.id);
      return entry?.userId === where.userId ? { readAt: entry.readAt } : null;
    }),
  };
  const transaction = { notification };
  const database = {
    ...transaction,
    $transaction: vi.fn(async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;
  const app = express();
  app.use('/api/v1', createNotificationsRouter(database, accessSecret, issuer));
  app.use(express.json());
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
    notifications,
    request: (userId: string, method: string, path: string) =>
      fetch(`http://127.0.0.1:${address.port}/api/v1/notifications${path}`, {
        method,
        headers: { Authorization: `Bearer ${signAccessToken(userId, accessSecret, issuer)}` },
      }),
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

describe('notification routes', () => {
  it('lists only the owner notifications with pagination and unread count', async () => {
    const api = createTestApi();
    const response = await api.request(userA, 'GET', '?pageSize=1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          id: notificationA,
          priceAtTrigger: 9.25,
          currency: 'USD',
          game: { title: 'Test Game' },
        },
      ],
      pagination: { totalItems: 1, pageSize: 1 },
      unreadCount: 1,
    });
    expect((await api.request(userA, 'GET', '?unreadOnly=true&pageSize=51')).status).toBe(400);
    expect(await (await api.request(userB, 'GET', '')).json()).toMatchObject({
      data: [{ id: notificationB }],
    });
  });

  it('returns an unread count scoped to the user', async () => {
    const api = createTestApi();
    expect(await (await api.request(userA, 'GET', '/unread-count')).json()).toEqual({
      unreadCount: 1,
    });
    expect(
      await (
        await api.request('3e3b8681-16bb-4a40-8b5a-836a4546a02e', 'GET', '/unread-count')
      ).json(),
    ).toEqual({ unreadCount: 0 });
  });

  it('marks one notification read idempotently and hides other users notifications', async () => {
    const api = createTestApi();
    const path = `/${notificationA}/read`;
    const first = await api.request(userA, 'PATCH', path);
    expect(first.status).toBe(200);
    const firstReadAt = (await first.json()).readAt;
    expect((await api.request(userA, 'PATCH', path)).status).toBe(200);
    expect(api.notifications.get(notificationA)?.readAt?.toISOString()).toBe(firstReadAt);
    expect((await api.request(userB, 'PATCH', path)).status).toBe(404);
  });

  it('marks all and only the current user notifications as read', async () => {
    const api = createTestApi();
    const response = await api.request(userA, 'PATCH', '/read-all');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1 });
    expect(api.notifications.get(notificationA)?.readAt).toBeInstanceOf(Date);
    expect(api.notifications.get(notificationB)?.readAt).toBeNull();
    expect(await (await api.request(userA, 'PATCH', '/read-all')).json()).toEqual({ updated: 0 });
  });
});
