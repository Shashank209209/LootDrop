import { Prisma, type PrismaClient } from '@prisma/client';
import { dealsQuerySchema, type DealsQuery } from '@lootdrop/contracts';
import { Router, type Request, type Response } from 'express';
import { dealSelect, serializeDeal } from './deal-serialization.js';

type DealsDatabase = Pick<PrismaClient, '$transaction' | 'store' | 'storeListing'>;

const multiValueParameters = new Set(['store', 'genre', 'platform']);
const allowedQueryParameters = new Set([
  ...multiValueParameters,
  'q',
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
    if (!multiValueParameters.has(key) && values.length > 1) {
      return {
        success: false as const,
        message: `Query parameter "${key}" may only be specified once`,
      };
    }
    if (multiValueParameters.has(key)) {
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
    case 'rating_desc':
      return [
        { game: { userRating: { sort: 'desc', nulls: 'last' } } },
        { discountPercent: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ];
  }
}

function listingWhere(query: DealsQuery): Prisma.StoreListingWhereInput {
  const storeFilter =
    query.store.length > 0
      ? {
          is: {
            isActive: true,
            OR: query.store.map((store) =>
              /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(store)
                ? { id: store }
                : { slug: store },
            ),
          },
        }
      : undefined;
  const escapedSearch = query.q?.replace(/[\\%_]/g, '\\$&');
  const game: Prisma.GameWhereInput = {
    ...(escapedSearch ? { title: { contains: escapedSearch, mode: 'insensitive' } } : {}),
    ...(query.genre.length ? { genres: { some: { genre: { slug: { in: query.genre } } } } } : {}),
    ...(query.platform.length
      ? { platforms: { some: { platform: { slug: { in: query.platform } } } } }
      : {}),
  };

  return {
    isOnSale: query.onSale,
    store: storeFilter ?? { is: { isActive: true } },
    ...(Object.keys(game).length ? { game } : {}),
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
      const result = await database.$transaction(
        async (transaction) => {
          const [genres, platforms] = await Promise.all([
            query.genre.length
              ? transaction.genre.findMany({
                  where: { slug: { in: query.genre } },
                  select: { slug: true },
                })
              : [],
            query.platform.length
              ? transaction.platform.findMany({
                  where: { slug: { in: query.platform } },
                  select: { slug: true },
                })
              : [],
          ]);
          if (genres.length !== query.genre.length) return { error: 'Unknown genre slug' } as const;
          if (platforms.length !== query.platform.length) {
            return { error: 'Unknown platform slug' } as const;
          }
          const [count, rows] = await Promise.all([
            transaction.storeListing.count({ where }),
            transaction.storeListing.findMany({
              where,
              orderBy: dealOrderBy(query.sort),
              skip: (query.page - 1) * query.pageSize,
              take: query.pageSize,
              select: dealSelect,
            }),
          ]);
          return { totalItems: count, listings: rows };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      if (result.error) {
        sendQueryError(response, result.error);
        return;
      }
      const { totalItems, listings } = result;
      const totalPages = Math.ceil(totalItems / query.pageSize);
      response.json({
        data: listings.map(serializeDeal),
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
