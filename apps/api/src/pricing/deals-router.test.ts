import { Prisma, type PrismaClient } from '@prisma/client';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDealsRouter } from './deals-router.js';

const servers: Array<ReturnType<express.Express['listen']>> = [];

const listingRows = [
  {
    id: 'listing-1',
    gameId: 'game-1',
    currentPrice: new Prisma.Decimal('9.5'),
    regularPrice: new Prisma.Decimal('19.99'),
    discountPercent: 50,
    currency: 'USD',
    isOnSale: true,
    url: 'https://example.com/deal-1',
    lastCheckedAt: new Date('2026-11-05T12:00:00.000Z'),
    game: { title: 'First Game', slug: 'first-game' },
    store: { id: 'store-1', name: 'Steam', slug: 'steam' },
  },
  {
    id: 'listing-2',
    gameId: 'game-2',
    currentPrice: new Prisma.Decimal('4.99'),
    regularPrice: null,
    discountPercent: 75,
    currency: 'USD',
    isOnSale: true,
    url: 'https://example.com/deal-2',
    lastCheckedAt: new Date('2026-11-04T12:00:00.000Z'),
    game: { title: 'Second Game', slug: 'second-game' },
    store: { id: 'store-2', name: 'GOG', slug: 'gog' },
  },
  {
    id: 'listing-3',
    gameId: 'game-3',
    currentPrice: new Prisma.Decimal('14.99'),
    regularPrice: new Prisma.Decimal('29.99'),
    discountPercent: 50,
    currency: 'USD',
    isOnSale: true,
    url: 'https://example.com/deal-3',
    lastCheckedAt: new Date('2026-11-03T12:00:00.000Z'),
    game: { title: 'Third Game', slug: 'third-game' },
    store: { id: 'store-1', name: 'Steam', slug: 'steam' },
  },
];

function createTestApi(options: { total?: number; rows?: typeof listingRows } = {}) {
  const rows = options.rows ?? listingRows;
  const transaction = {
    storeListing: {
      count: vi.fn(async () => options.total ?? rows.length),
      findMany: vi.fn(async (args: Prisma.StoreListingFindManyArgs) =>
        rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length)),
      ),
    },
    store: {
      findMany: vi.fn(async () => [{ id: 'store-1', name: 'Steam', slug: 'steam' }]),
    },
  };
  const database = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    store: transaction.store,
    storeListing: transaction.storeListing,
  } as unknown as PrismaClient;
  const app = express();
  app.use('/api/v1', createDealsRouter(database));
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');

  return {
    transaction,
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

describe('GET /api/v1/deals', () => {
  it('returns selected live deal fields with numeric money and pagination', async () => {
    const api = createTestApi({ total: 3 });
    const response = await api.request('/api/v1/deals?pageSize=2');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'listing-1',
          gameId: 'game-1',
          gameTitle: 'First Game',
          gameSlug: 'first-game',
          store: { id: 'store-1', name: 'Steam', slug: 'steam' },
          currentPrice: 9.5,
          regularPrice: 19.99,
          discountPercent: 50,
          currency: 'USD',
          isOnSale: true,
          dealUrl: 'https://example.com/deal-1',
          lastCheckedAt: '2026-11-05T12:00:00.000Z',
        },
        {
          id: 'listing-2',
          gameId: 'game-2',
          gameTitle: 'Second Game',
          gameSlug: 'second-game',
          store: { id: 'store-2', name: 'GOG', slug: 'gog' },
          currentPrice: 4.99,
          regularPrice: null,
          discountPercent: 75,
          currency: 'USD',
          isOnSale: true,
          dealUrl: 'https://example.com/deal-2',
          lastCheckedAt: '2026-11-04T12:00:00.000Z',
        },
      ],
      pagination: {
        page: 1,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
        hasNextPage: true,
      },
    });
    expect(api.transaction.storeListing.count).toHaveBeenCalledOnce();
    expect(api.transaction.storeListing.findMany).toHaveBeenCalledOnce();
    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0]).toMatchObject({
      skip: 0,
      take: 2,
    });
    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].orderBy).toEqual([
      { discountPercent: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });

  it('returns an empty result with zero total pages', async () => {
    const api = createTestApi({ total: 0, rows: [] });
    const response = await api.request('/api/v1/deals');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [],
      pagination: { totalItems: 0, totalPages: 0, hasNextPage: false },
    });
  });

  it('applies search as a literal, case-insensitive game-title filter', async () => {
    const api = createTestApi();
    await api.request('/api/v1/deals?q=100%25_%5C');

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].where?.game).toEqual({
      title: { contains: '100\\%\\_\\\\', mode: 'insensitive' },
    });
  });

  it('filters by slugs without comparing slug text to the UUID id column', async () => {
    const api = createTestApi();
    await api.request('/api/v1/deals?store=steam');

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].where?.store).toEqual({
      is: {
        isActive: true,
        OR: [{ slug: 'steam' }],
      },
    });
  });

  it('returns an empty result for an unknown store slug', async () => {
    const api = createTestApi({ total: 0, rows: [] });
    const response = await api.request('/api/v1/deals?store=not-a-store');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [],
      pagination: { totalItems: 0, totalPages: 0 },
    });
  });

  it('accepts a UUID store id', async () => {
    const api = createTestApi();
    await api.request('/api/v1/deals?store=9ed24074-d90d-4a45-a7de-082c1dac949d');

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].where?.store).toEqual({
      is: {
        isActive: true,
        OR: [{ id: '9ed24074-d90d-4a45-a7de-082c1dac949d' }],
      },
    });
  });

  it('accepts two stores with repeated and comma-separated values', async () => {
    const api = createTestApi();
    await api.request('/api/v1/deals?store=steam,gog');

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].where?.store).toEqual({
      is: {
        isActive: true,
        OR: [{ slug: 'steam' }, { slug: 'gog' }],
      },
    });
  });

  it('combines multiple stores with search and sorting', async () => {
    const api = createTestApi();
    await api.request('/api/v1/deals?store=steam,gog&q=borderlands&sort=price_asc');

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        store: {
          is: { isActive: true, OR: [{ slug: 'steam' }, { slug: 'gog' }] },
        },
        game: { title: { contains: 'borderlands', mode: 'insensitive' } },
      },
      orderBy: [{ currentPrice: 'asc' }, { id: 'asc' }],
    });
  });
  it('supports onSale=false', async () => {
    const api = createTestApi();
    await api.request('/api/v1/deals?onSale=false');

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].where?.isOnSale).toBe(false);
  });

  it('applies price bounds and minimum discount', async () => {
    const api = createTestApi();
    await api.request('/api/v1/deals?minPrice=2.5&maxPrice=25&minDiscount=30');

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].where).toMatchObject({
      currentPrice: { gte: 2.5, lte: 25 },
      discountPercent: { gte: 30 },
    });
  });

  it.each([
    ['discount_desc', [{ discountPercent: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]],
    ['price_asc', [{ currentPrice: 'asc' }, { id: 'asc' }]],
    ['price_desc', [{ currentPrice: 'desc' }, { id: 'asc' }]],
    ['newest', [{ lastCheckedAt: 'desc' }, { id: 'asc' }]],
    ['title_asc', [{ game: { title: 'asc' } }, { id: 'asc' }]],
  ] as const)('uses stable ordering for %s', async (sort, orderBy) => {
    const api = createTestApi();
    await api.request(`/api/v1/deals?sort=${sort}`);
    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0].orderBy).toEqual(orderBy);
  });

  it.each([
    ['first page', 1, 0, 2],
    ['last page', 2, 2, 1],
    ['beyond last page', 3, 4, 0],
  ])('returns the correct %s boundary', async (_label, page, skip, count) => {
    const api = createTestApi({ total: 3 });
    const response = await api.request(`/api/v1/deals?page=${page}&pageSize=2`);
    const body = (await response.json()) as {
      data: unknown[];
      pagination: Record<string, unknown>;
    };

    expect(api.transaction.storeListing.findMany.mock.calls[0]?.[0]).toMatchObject({
      skip,
      take: 2,
    });
    expect(body.data).toHaveLength(count);
    expect(body.pagination).toMatchObject({
      page,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
      hasNextPage: page < 2,
    });
  });

  it.each([
    ['negative price', 'minPrice=-1'],
    ['minDiscount above 100', 'minDiscount=101'],
    ['unknown sort', 'sort=surprise'],
    ['non-numeric page', 'page=abc'],
    ['minPrice greater than maxPrice', 'minPrice=10&maxPrice=2'],
    ['pageSize above maximum', 'pageSize=51'],
    ['unknown parameter', 'unexpected=true'],
    ['repeated scalar', 'page=1&page=2'],
    ['overlong search', `q=${'x'.repeat(101)}`],
  ])('returns the contract error shape for %s', async (_label, query) => {
    const api = createTestApi();
    const response = await api.request(`/api/v1/deals?${query}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_QUERY', message: expect.any(String), details: null },
    });
    expect(api.transaction.storeListing.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/stores', () => {
  it('returns active store fields only', async () => {
    const api = createTestApi();
    const response = await api.request('/api/v1/stores');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: 'store-1', name: 'Steam', slug: 'steam' }],
    });
    expect(api.transaction.store.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });
});
