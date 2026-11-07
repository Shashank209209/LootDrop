import { Prisma, type PrismaClient } from '@prisma/client';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCuratedDealsRouter } from './curated-deals-router.js';

const servers: Array<ReturnType<express.Express['listen']>> = [];
const store = { id: 'store-1', name: 'Steam', slug: 'steam' };

function listing(
  id: string,
  gameId: string,
  currentPrice: string,
  regularPrice: string,
  discount: number,
  checked: string,
  currency = 'USD',
) {
  return {
    id,
    gameId,
    currentPrice: new Prisma.Decimal(currentPrice),
    regularPrice: new Prisma.Decimal(regularPrice),
    discountPercent: discount,
    currency,
    isOnSale: true,
    url: `https://example.com/${id}`,
    lastCheckedAt: new Date(checked),
    game: { title: `Game ${gameId}`, slug: `game-${gameId}` },
    store,
  };
}

function createTestApi(
  options: {
    listings?: ReturnType<typeof listing>[];
    groups?: Array<{
      listingId: string;
      currency: string;
      _min: { price: Prisma.Decimal | null };
      _count: { _all: number };
    }>;
  } = {},
) {
  const findMany = vi.fn<
    (args: Prisma.StoreListingFindManyArgs) => Promise<ReturnType<typeof listing>[]>
  >(async () => options.listings ?? []);
  const groupBy = vi.fn<
    (args: Prisma.PriceSnapshotGroupByArgs) => Promise<NonNullable<typeof options.groups>>
  >(async () => options.groups ?? []);
  const database = {
    storeListing: { findMany },
    priceSnapshot: { groupBy },
  } as unknown as PrismaClient;
  const app = express();
  app.use('/api/v1', createCuratedDealsRouter(database));
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');

  return {
    findMany,
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

describe('GET /api/v1/deals/best', () => {
  it('uses the regular-price threshold, stable ordering and one listing per game/currency', async () => {
    const api = createTestApi({
      listings: [
        listing('other-currency', 'game-1', '1.00', '20.00', 95, '2026-01-03T00:00:00Z', 'EUR'),
        listing('duplicate-game', 'game-1', '3.00', '10.00', 80, '2026-01-03T00:00:00Z'),
        listing('best-1', 'game-1', '4.00', '10.00', 80, '2026-01-03T00:00:00Z'),
      ],
    });
    const response = await api.request('/api/v1/deals/best');
    const body = (await response.json()) as { data: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.data.map((item) => item.id)).toEqual(['other-currency', 'duplicate-game']);
    expect(api.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        isOnSale: true,
        regularPrice: { gte: new Prisma.Decimal('5.00') },
        store: { is: { isActive: true } },
      },
      orderBy: [
        { discountPercent: { sort: 'desc', nulls: 'last' } },
        { currentPrice: 'asc' },
        { id: 'asc' },
      ],
    });
  });

  it('accepts a bounded limit and rejects an invalid limit', async () => {
    const api = createTestApi();
    expect((await api.request('/api/v1/deals/best?limit=24')).status).toBe(200);
    expect((await api.request('/api/v1/deals/best?limit=25')).status).toBe(400);
    expect((await api.request('/api/v1/deals/best?unknown=1')).status).toBe(400);
  });
});

describe('GET /api/v1/deals/free', () => {
  it('selects zero-price listings with a positive regular price, newest first', async () => {
    const api = createTestApi({
      listings: [listing('free-1', 'game-1', '0', '10.00', 100, '2026-01-03T00:00:00Z')],
    });
    const response = await api.request('/api/v1/deals/free');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ id: 'free-1', currentPrice: 0 }] });
    expect(api.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        currentPrice: new Prisma.Decimal('0'),
        regularPrice: { gt: new Prisma.Decimal('0') },
        store: { is: { isActive: true } },
      },
      orderBy: [{ lastCheckedAt: 'desc' }, { id: 'asc' }],
      take: 20,
    });
  });

  it('allows an empty result and caps limits at 50', async () => {
    const api = createTestApi();
    expect(await (await api.request('/api/v1/deals/free')).json()).toEqual({ data: [] });
    expect((await api.request('/api/v1/deals/free?limit=51')).status).toBe(400);
  });
});

describe('GET /api/v1/deals/historical-lows', () => {
  it('requires two snapshots and current price at or below the matching-currency low', async () => {
    const api = createTestApi({
      groups: [
        {
          listingId: 'one-snapshot',
          currency: 'USD',
          _min: { price: new Prisma.Decimal('1.00') },
          _count: { _all: 1 },
        },
        {
          listingId: 'record-low',
          currency: 'USD',
          _min: { price: new Prisma.Decimal('5.00') },
          _count: { _all: 2 },
        },
        {
          listingId: 'not-low',
          currency: 'USD',
          _min: { price: new Prisma.Decimal('5.00') },
          _count: { _all: 2 },
        },
        {
          listingId: 'currency-changed',
          currency: 'EUR',
          _min: { price: new Prisma.Decimal('1.00') },
          _count: { _all: 3 },
        },
      ],
      listings: [
        listing('one-snapshot', 'game-1', '1.00', '10', 90, '2026-01-03T00:00:00Z'),
        listing('record-low', 'game-2', '5.00', '10', 50, '2026-01-03T00:00:00Z'),
        listing('not-low', 'game-3', '6.00', '10', 40, '2026-01-03T00:00:00Z'),
        listing('currency-changed', 'game-4', '0.50', '10', 95, '2026-01-03T00:00:00Z', 'USD'),
      ],
    });
    const response = await api.request('/api/v1/deals/historical-lows');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: 'record-low', lowestRecordedPrice: 5 }],
    });
    expect(api.groupBy.mock.calls[0]?.[0]).toMatchObject({
      by: ['listingId', 'currency'],
      _min: { price: true },
      _count: { _all: true },
    });
  });

  it('returns an empty result and validates the limit', async () => {
    const api = createTestApi();
    expect(await (await api.request('/api/v1/deals/historical-lows')).json()).toEqual({
      data: [],
    });
    expect((await api.request('/api/v1/deals/historical-lows?limit=25')).status).toBe(400);
  });
});
