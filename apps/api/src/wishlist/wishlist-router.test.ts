import { Prisma, type PrismaClient } from '@prisma/client';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../auth/jwt.js';
import { createWishlistRouter } from './wishlist-router.js';

const accessSecret = 'wishlist-test-secret-longer-than-thirty-two-characters';
const issuer = 'wishlist-test';
const userA = '20da2e1d-c56e-4874-8e7c-f5d15d38d502';
const userB = '5e3b8681-16bb-4a40-8b5a-836a4546a02e';
const gameA = '35e98245-82b3-4fef-a482-6d3c89e97e29';
const gameB = 'e42d2f55-11fc-4996-a944-4c7f2507958a';
const gameC = '8a00c06d-6a65-47c6-893d-d57a85c25567';
const storeA = { id: '0e01582f-3fbe-49e3-ab5a-e4e40d30e4a3', name: 'Steam', slug: 'steam' };
const servers: Array<ReturnType<express.Express['listen']>> = [];

type GameRecord = { id: string; slug: string; title: string };
type WishlistRecord = { userId: string; gameId: string; addedAt: Date };
type ListingRecord = {
  id: string;
  gameId: string;
  currentPrice: Prisma.Decimal;
  regularPrice: Prisma.Decimal | null;
  discountPercent: number | null;
  currency: string;
  isOnSale: boolean;
  url: string;
  store: typeof storeA;
};

function createTestApi(options: { games?: GameRecord[]; listings?: ListingRecord[] } = {}) {
  const games = new Map(
    (
      options.games ?? [
        { id: gameA, slug: 'game-a', title: 'Game A' },
        { id: gameB, slug: 'game-b', title: 'Game B' },
        { id: gameC, slug: 'game-c', title: 'Game C' },
      ]
    ).map((game) => [game.id, game]),
  );
  const wishlist = new Map<string, WishlistRecord>();
  const listings = options.listings ?? [];
  const transaction = {
    game: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => games.get(where.id) ?? null,
      ),
    },
    wishlist: {
      count: vi.fn(
        async ({ where }: { where: { userId: string } }) =>
          [...wishlist.values()].filter((entry) => entry.userId === where.userId).length,
      ),
      findMany: vi.fn(
        async ({
          where,
          skip = 0,
          take = 1000,
          select,
        }: {
          where: { userId: string };
          skip?: number;
          take?: number;
          select: { gameId?: boolean; game?: unknown };
        }) => {
          const entries = [...wishlist.values()]
            .filter((entry) => entry.userId === where.userId)
            .sort(
              (left, right) =>
                right.addedAt.getTime() - left.addedAt.getTime() ||
                left.gameId.localeCompare(right.gameId),
            )
            .slice(skip, skip + take);
          if (select.game) {
            return entries.map((entry) => {
              const game = games.get(entry.gameId);
              if (!game) throw new Error('wishlist game missing from fixture');
              return {
                gameId: entry.gameId,
                addedAt: entry.addedAt,
                game: { slug: game.slug, title: game.title },
              };
            });
          }
          return entries.map((entry) => ({ gameId: entry.gameId }));
        },
      ),
      createMany: vi.fn(async ({ data }: { data: Array<{ userId: string; gameId: string }> }) => {
        let count = 0;
        for (const entry of data) {
          const key = `${entry.userId}:${entry.gameId}`;
          if (wishlist.has(key)) continue;
          wishlist.set(key, { ...entry, addedAt: new Date() });
          count += 1;
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string; gameId: string } }) => ({
        count: Number(wishlist.delete(`${where.userId}:${where.gameId}`)),
      })),
    },
    storeListing: {
      findMany: vi.fn(async ({ where }: { where: { gameId: { in: string[] } } }) =>
        listings
          .filter((listing) => where.gameId.in.includes(listing.gameId))
          .sort(
            (left, right) =>
              left.currency.localeCompare(right.currency) ||
              left.currentPrice.comparedTo(right.currentPrice) ||
              left.id.localeCompare(right.id),
          ),
      ),
    },
  };
  const database = {
    ...transaction,
    $transaction: vi.fn(async <T>(callback: (tx: typeof transaction) => Promise<T>): Promise<T> =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/wishlist', createWishlistRouter(database, accessSecret, issuer));
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      void error;
      void next;
      response.status(500).json({ error: { code: 'TEST_ERROR', message: 'Test request failed' } });
    },
  );
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');

  return {
    wishlist,
    transaction,
    request: (userId: string, path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}/api/v1/wishlist${path}`, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${signAccessToken(userId, accessSecret, issuer)}`,
        },
      }),
    anonymousRequest: (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}/api/v1/wishlist${path}`, init),
  };
}

function postGame(gameId: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId }),
  };
}

function listing(gameId: string, id: string, price: string, currency: string): ListingRecord {
  return {
    id,
    gameId,
    currentPrice: new Prisma.Decimal(price),
    regularPrice: new Prisma.Decimal('20.00'),
    discountPercent: 50,
    currency,
    isOnSale: true,
    url: `https://example.test/deals/${id}`,
    store: storeA,
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

describe('wishlist routes', () => {
  it('requires an access token', async () => {
    const api = createTestApi();
    const response = await api.anonymousRequest('/');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('adds games idempotently and returns 404 for an unknown game', async () => {
    const api = createTestApi();
    const first = await api.request(userA, '/', postGame(gameA));
    const second = await api.request(userA, '/', postGame(gameA));

    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ gameId: gameA, added: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ gameId: gameA, added: false });
    expect(api.wishlist.size).toBe(1);

    const missing = await api.request(userA, '/', postGame('a0000000-0000-4000-8000-000000000001'));
    expect(missing.status).toBe(404);
  });

  it('lists newest first with pagination and one batched best-listing query', async () => {
    const api = createTestApi({
      listings: [
        listing(gameA, 'listing-usd', '1.00', 'USD'),
        listing(gameA, 'listing-eur-expensive', '9.00', 'EUR'),
        listing(gameA, 'listing-eur-cheap', '4.00', 'EUR'),
        listing(gameB, 'listing-b', '3.50', 'USD'),
      ],
    });
    for (const gameId of [gameA, gameB, gameC]) {
      await api.request(userA, '/', postGame(gameId));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const firstPage = await api.request(userA, '/?pageSize=2');
    const firstBody = await firstPage.json();
    expect(firstPage.status).toBe(200);
    expect(firstBody.pagination).toEqual({
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
      hasNextPage: true,
    });
    expect(firstBody.data.map((entry: { gameId: string }) => entry.gameId)).toEqual([gameC, gameB]);

    const secondPage = await api.request(userA, '/?page=2&pageSize=2');
    const secondBody = await secondPage.json();
    expect(secondBody.data[0]).toMatchObject({
      gameId: gameA,
      bestListing: {
        currentPrice: 4,
        currency: 'EUR',
        store: storeA,
      },
    });
    expect(api.transaction.storeListing.findMany).toHaveBeenCalledTimes(2);
    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].where.gameId.in).toEqual([
      gameC,
      gameB,
    ]);
  });

  it('returns null bestListing when a wishlisted game has no active listings', async () => {
    const api = createTestApi();
    await api.request(userA, '/', postGame(gameC));
    const response = await api.request(userA, '/');
    const body = await response.json();

    expect(body.data[0]).toMatchObject({ gameId: gameC, bestListing: null });
  });

  it('isolates users and allows repeated deletes', async () => {
    const api = createTestApi();
    await api.request(userA, '/', postGame(gameA));
    await api.request(userB, '/', postGame(gameA));

    const removed = await api.request(userA, `/${gameA}`, { method: 'DELETE' });
    const removedAgain = await api.request(userA, `/${gameA}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect(removedAgain.status).toBe(204);

    const userAList = await api.request(userA, '/');
    const userBList = await api.request(userB, '/');
    expect((await userAList.json()).data).toEqual([]);
    expect((await userBList.json()).data).toHaveLength(1);
  });

  it('returns at most 1000 IDs and rejects invalid pagination', async () => {
    const api = createTestApi();
    await api.request(userA, '/', postGame(gameA));
    await api.request(userA, '/', postGame(gameB));

    const ids = await api.request(userA, '/ids');
    expect(await ids.json()).toEqual({ gameIds: expect.arrayContaining([gameA, gameB]) });
    const invalid = await api.request(userA, '/?pageSize=51');
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
});
