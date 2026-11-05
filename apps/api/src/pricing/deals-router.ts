import { Prisma, type PrismaClient } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { dealsQuerySchema, type DealsQuery } from './deals-contract.js';

type DealsDatabase = Pick<PrismaClient, '$transaction' | 'store' | 'storeListing'>;

const allowedQueryParameters = new Set([
  'q',
  'store',
  'onSale',
  'minPrice',
  'maxPrice',
  'minDiscount',
  'sort',
  'page',
  'pageSize',
]);

function parseDealsQuery(request: Request) {
  const searchParams = new URL(request.originalUrl, 'http://localhost').searchParams;
  const raw: Record<string, string | string[]> = {};

  for (const key of new Set(searchParams.keys())) {
    if (!allowedQueryParameters.has(key)) {
      return { success: false as const, message: `Unknown query parameter: ${key}` };
    }
    const values = searchParams.getAll(key);
    if (key !== 'store' && values.length > 1) {
      return {
        success: false as const,
        message: `Query parameter "${key}" may only be specified once`,
      };
    }
    if (key === 'store') {
      raw[key] = values;
    } else {
      const value = values[0];
      if (value !== undefined) raw[key] = value;
    }
  }

  const parsed = dealsQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
    };
  }
  return { success: true as const, data: parsed.data };
}

export function dealOrderBy(
  sort: DealsQuery['sort'],
): Prisma.StoreListingOrderByWithRelationInput[] {
  switch (sort) {
    case 'discount_desc':
      return [{ discountPercent: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    case 'price_asc':
      return [{ currentPrice: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ currentPrice: 'desc' }, { id: 'asc' }];
    case 'newest':
      return [{ lastCheckedAt: 'desc' }, { id: 'asc' }];
    case 'title_asc':
      return [{ game: { title: 'asc' } }, { id: 'asc' }];
  }
}

function listingWhere(query: DealsQuery): Prisma.StoreListingWhereInput {
  const storeFilter =
    query.store.length > 0
      ? {
          is: {
            OR: query.store.flatMap((store) => [{ id: store }, { slug: store }]),
          },
        }
      : undefined;
  const escapedSearch = query.q?.replace(/[\\%_]/g, '\\$&');

  return {
    isOnSale: query.onSale,
    store: storeFilter ? { is: { isActive: true, ...storeFilter.is } } : { is: { isActive: true } },
    ...(escapedSearch ? { game: { title: { contains: escapedSearch, mode: 'insensitive' } } } : {}),
    ...(query.minPrice !== undefined || query.maxPrice !== undefined
      ? {
          currentPrice: {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          },
        }
      : {}),
    ...(query.minDiscount !== undefined ? { discountPercent: { gte: query.minDiscount } } : {}),
  };
}

function moneyNumber(value: Prisma.Decimal | null): number | null {
  if (value === null) return null;
  return Math.round((value.toNumber() + Number.EPSILON) * 100) / 100;
}

function sendQueryError(response: Response, message: string) {
  response.status(400).json({
    error: { code: 'INVALID_QUERY', message, details: null },
  });
}

export function createDealsRouter(database: DealsDatabase): Router {
  const router = Router();

  router.get('/deals', async (request, response, next) => {
    const parsed = parseDealsQuery(request);
    if (!parsed.success) {
      sendQueryError(response, parsed.message);
      return;
    }

    const query = parsed.data;
    const where = listingWhere(query);
    try {
      const { totalItems, listings } = await database.$transaction(
        async (transaction) => {
          const [count, rows] = await Promise.all([
            transaction.storeListing.count({ where }),
            transaction.storeListing.findMany({
              where,
              orderBy: dealOrderBy(query.sort),
              skip: (query.page - 1) * query.pageSize,
              take: query.pageSize,
              select: {
                id: true,
                gameId: true,
                currentPrice: true,
                regularPrice: true,
                discountPercent: true,
                currency: true,
                isOnSale: true,
                url: true,
                lastCheckedAt: true,
                game: { select: { title: true, slug: true } },
                store: { select: { id: true, name: true, slug: true } },
              },
            }),
          ]);
          return { totalItems: count, listings: rows };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      const totalPages = Math.ceil(totalItems / query.pageSize);
      response.json({
        data: listings.map((listing) => ({
          id: listing.id,
          gameId: listing.gameId,
          gameTitle: listing.game.title,
          gameSlug: listing.game.slug,
          store: listing.store,
          currentPrice: moneyNumber(listing.currentPrice) ?? 0,
          regularPrice: moneyNumber(listing.regularPrice),
          discountPercent: listing.discountPercent,
          currency: listing.currency,
          isOnSale: listing.isOnSale,
          dealUrl: listing.url,
          lastCheckedAt: listing.lastCheckedAt.toISOString(),
        })),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalItems,
          totalPages,
          hasNextPage: query.page < totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/stores', async (_request, response, next) => {
    try {
      const stores = await database.store.findMany({
        where: { isActive: true },
        select: { id: true, name: true, slug: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      response.json({ data: stores });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
