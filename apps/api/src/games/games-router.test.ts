import { Prisma, type PrismaClient } from '@prisma/client';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGamesRouter } from './games-router.js';

const servers: Array<ReturnType<express.Express['listen']>> = [];
const capturedAt = (day: number) => new Date(Date.UTC(2026, 0, day));
const storeSteam = { id: 'store-1', name: 'Steam', slug: 'steam' };
const storeGog = { id: 'store-2', name: 'GOG', slug: 'gog' };

function listing(
  id: string,
  store: typeof storeSteam,
  price: string,
  currency = 'USD',
  gameId = 'game-1',
) {
  return {
    id,
    gameId,
    currentPrice: new Prisma.Decimal(price),
    regularPrice: new Prisma.Decimal('20.00'),
    discountPercent: 50,
    currency,
    isOnSale: true,
    url: `https://example.com/${id}`,
    lastCheckedAt: capturedAt(30),
    store,
  };
}

function snapshot(day: number, price: string, currency = 'USD') {
  return {
    capturedAt: capturedAt(day),
    price: new Prisma.Decimal(price),
    regularPrice: new Prisma.Decimal('20.00'),
    discountPercent: 50,
    currency,
  };
}

function createTestApi(
  overrides: {
    games?: ReturnType<typeof vi.fn>;
    game?: ReturnType<typeof vi.fn>;
    store?: ReturnType<typeof vi.fn>;
    groups?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const gameFindMany = overrides.games ?? vi.fn(async () => []);
  const gameFindUnique =
    overrides.game ?? vi.fn(async () => ({ listings: [] as ReturnType<typeof listing>[] }));
  const storeFindUnique = overrides.store ?? vi.fn(async () => ({ id: 'store-1' }));
  const groupBy = overrides.groups ?? vi.fn(async () => []);
  const database = {
    game: { findMany: gameFindMany, findUnique: gameFindUnique },
    store: { findUnique: storeFindUnique },
    priceSnapshot: { groupBy },
  } as unknown as PrismaClient;
  const app = express();
  app.use('/api/v1', createGamesRouter(database));
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');

  return {
    gameFindMany,
    gameFindUnique,
    storeFindUnique,
    groupBy,
    request: (path: string) => fetch(`http://127.0.0.1:${address.port}${path}`),
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

describe('GET /api/v1/games/search', () => {
  it('ranks title prefixes first and selects a best listing within one currency', async () => {
    const api = createTestApi({
      games: vi.fn(async () => [
        {
          id: 'game-2',
          slug: 'a-game',
          title: 'The Alpha Game',
          listings: [
            { currentPrice: new Prisma.Decimal('3.00'), discountPercent: 80, currency: 'USD' },
          ],
        },
        {
          id: 'game-1',
          slug: 'alpha',
          title: 'Alpha',
          listings: [
            { currentPrice: new Prisma.Decimal('8.00'), discountPercent: 40, currency: 'EUR' },
            { currentPrice: new Prisma.Decimal('5.00'), discountPercent: 60, currency: 'USD' },
          ],
        },
      ]),
    });

    const response = await api.request('/api/v1/games/search?q=alpha');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'game-1',
          slug: 'alpha',
          title: 'Alpha',
          bestPrice: 8,
          currency: 'EUR',
          bestDiscountPercent: 40,
        },
        {
          id: 'game-2',
          slug: 'a-game',
          title: 'The Alpha Game',
          bestPrice: 3,
          currency: 'USD',
          bestDiscountPercent: 80,
        },
      ],
    });
    expect(api.gameFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { title: { contains: 'alpha', mode: 'insensitive' } },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });
  });

  it('limits results to eight and treats special characters literally', async () => {
    const games = Array.from({ length: 10 }, (_, index) => ({
      id: `game-${index}`,
      slug: `alpha-${index}`,
      title: `Alpha ${index}`,
      listings: [],
    }));
    const api = createTestApi({ games: vi.fn(async () => games) });
    const response = await api.request('/api/v1/games/search?q=100%25_%5C');

    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(8);
    expect(api.gameFindMany.mock.calls[0]?.[0].where.title.contains).toBe('100\\%\\_\\\\');
  });

  it.each(['', 'a', 'x'.repeat(101)])('rejects invalid search length %s', async (query) => {
    const api = createTestApi();
    const response = await api.request(`/api/v1/games/search?q=${query}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_QUERY', message: expect.any(String), details: null },
    });
    expect(api.gameFindMany).not.toHaveBeenCalled();
  });

  it('rejects a missing q parameter', async () => {
    const response = await createTestApi().request('/api/v1/games/search');
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/games/:slug', () => {
  it('returns store listings and snapshot summary without comparing currencies', async () => {
    const api = createTestApi({
      game: vi.fn(async () => ({
        id: 'game-1',
        slug: 'game-one',
        title: 'Game One',
        listings: [listing('usd-1', storeSteam, '5.00'), listing('eur-1', storeGog, '3.00', 'EUR')],
      })),
      groups: vi.fn(async () => [
        {
          currency: 'USD',
          _min: { price: new Prisma.Decimal('4.00') },
          _max: { price: new Prisma.Decimal('12.00') },
          _count: { _all: 2 },
        },
        {
          currency: 'EUR',
          _min: { price: new Prisma.Decimal('2.00') },
          _max: { price: new Prisma.Decimal('8.00') },
          _count: { _all: 2 },
        },
      ]),
    });
    const response = await api.request('/api/v1/games/game-one');
    const body = (await response.json()) as { data: { listings: unknown[]; summary: object } };

    expect(response.status).toBe(200);
    expect(body.data.listings).toHaveLength(2);
    expect(body.data.summary).toEqual({
      bestListingId: null,
      lowestRecordedPrice: null,
      highestRecordedPrice: null,
      snapshotCount: 4,
    });
    expect(api.gameFindUnique.mock.calls[0]?.[0].select.listings.orderBy).toEqual([
      { currency: 'asc' },
      { currentPrice: 'asc' },
      { store: { name: 'asc' } },
      { id: 'asc' },
    ]);
  });

  it('returns currency-consistent summary fields for a single-currency game', async () => {
    const api = createTestApi({
      game: vi.fn(async () => ({
        id: 'game-1',
        slug: 'game-one',
        title: 'Game One',
        listings: [listing('listing-1', storeSteam, '5.00')],
      })),
      groups: vi.fn(async () => [
        {
          currency: 'USD',
          _min: { price: new Prisma.Decimal('2.00') },
          _max: { price: new Prisma.Decimal('20.00') },
          _count: { _all: 3 },
        },
      ]),
    });
    const response = await api.request('/api/v1/games/game-one');

    expect(await response.json()).toMatchObject({
      data: {
        summary: {
          bestListingId: 'listing-1',
          lowestRecordedPrice: 2,
          highestRecordedPrice: 20,
          snapshotCount: 3,
        },
      },
    });
  });

  it('returns 404 for an unknown game slug', async () => {
    const api = createTestApi({ game: vi.fn(async () => null) });
    const response = await api.request('/api/v1/games/missing-game');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Game not found', details: null },
    });
  });
});

describe('GET /api/v1/games/:slug/price-history', () => {
  it.each([
    ['30d', 30],
    ['90d', 90],
    ['1y', 365],
  ])('filters snapshots in the %s range', async (range, days) => {
    const api = createTestApi({
      game: vi.fn(async () => ({ listings: [] })),
    });
    const response = await api.request(
      `/api/v1/games/game-one/price-history?range=${range}&store=steam`,
    );

    expect(response.status).toBe(200);
    expect(api.gameFindUnique.mock.calls[0]?.[0]).toMatchObject({
      where: { slug: 'game-one' },
      select: {
        listings: {
          where: { store: { isActive: true, slug: 'steam' } },
        },
      },
    });
    const cutoff =
      api.gameFindUnique.mock.calls[0]?.[0].select.listings.select.priceSnapshots.where.capturedAt
        .gte;
    expect(cutoff).toBeInstanceOf(Date);
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual((days - 1) * 24 * 60 * 60 * 1000);
    expect(api.storeFindUnique).toHaveBeenCalledWith({
      where: { slug: 'steam' },
      select: { id: true },
    });
  });

  it('defaults to 90 days and returns empty points for sparse history', async () => {
    const api = createTestApi({
      game: vi.fn(async () => ({
        listings: [
          {
            id: 'listing-1',
            currency: 'USD',
            store: storeSteam,
            priceSnapshots: [],
          },
        ],
      })),
    });
    const response = await api.request('/api/v1/games/game-one/price-history');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ listingId: 'listing-1', points: [] }],
      range: { from: expect.any(String), to: expect.any(String) },
    });
    expect(
      api.gameFindUnique.mock.calls[0]?.[0].select.listings.select.priceSnapshots.where,
    ).toBeDefined();
  });

  it('keeps first, last and lowest points when downsampling', async () => {
    const points = Array.from({ length: 500 }, (_, index) => ({
      ...snapshot(index + 1, index === 237 ? '0.01' : String(index + 2)),
    }));
    const api = createTestApi({
      game: vi.fn(async () => ({
        listings: [
          {
            id: 'listing-1',
            currency: 'USD',
            store: storeSteam,
            priceSnapshots: points,
          },
        ],
      })),
    });
    const response = await api.request('/api/v1/games/game-one/price-history?range=all');
    const body = (await response.json()) as {
      data: Array<{ points: Array<{ capturedAt: string; price: number }> }>;
    };

    expect(body.data[0]?.points).toHaveLength(366);
    expect(body.data[0]?.points[0]?.price).toBe(2);
    expect(body.data[0]?.points.at(-1)?.price).toBe(501);
    expect(body.data[0]?.points.some((point) => point.price === 0.01)).toBe(true);
  });

  it('returns 404 for an unknown game and 400 for invalid range or store', async () => {
    const missingGame = createTestApi({ game: vi.fn(async () => null) });
    expect((await missingGame.request('/api/v1/games/missing/price-history')).status).toBe(404);

    const api = createTestApi();
    expect((await api.request('/api/v1/games/game-one/price-history?range=2d')).status).toBe(400);
    api.storeFindUnique.mockResolvedValueOnce(null);
    expect((await api.request('/api/v1/games/game-one/price-history?store=unknown')).status).toBe(
      400,
    );
  });
});
