import { Prisma, type PrismaClient } from '@prisma/client';
import {
  bestDealsQuerySchema,
  freeDealsQuerySchema,
  historicalLowsQuerySchema,
} from '@dealhunter/contracts';
import { Router, type Request, type Response } from 'express';
import { dealSelect, moneyNumber, serializeDeal } from './deal-serialization.js';

type CuratedDealsDatabase = Pick<PrismaClient, 'storeListing' | 'priceSnapshot'>;
type QuerySchema<T> = {
  safeParse: (
    input: unknown,
  ) =>
    { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
};

function parseLimit<T>(
  request: Request,
  schema: QuerySchema<T>,
): { success: true; data: T } | { success: false; message: string } {
  const searchParams = new URL(request.originalUrl, 'http://localhost').searchParams;
  const raw: Record<string, string> = {};
  for (const key of new Set(searchParams.keys())) {
    if (key !== 'limit') return { success: false, message: `Unknown query parameter: ${key}` };
    const values = searchParams.getAll(key);
    if (values.length !== 1) {
      return { success: false, message: 'Query parameter "limit" may only be specified once' };
    }
    const value = values[0];
    if (value !== undefined) raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? parsed
    : {
        success: false,
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      };
}

function invalidQuery(response: Response, message: string) {
  response.status(400).json({
    error: { code: 'INVALID_QUERY', message, details: null },
  });
}

export function createCuratedDealsRouter(database: CuratedDealsDatabase): Router {
  const router = Router();

  router.get('/deals/best', async (request, response, next) => {
    const parsed = parseLimit(request, bestDealsQuerySchema);
    if (!parsed.success) {
      invalidQuery(response, parsed.message);
      return;
    }

    try {
      const listings = await database.storeListing.findMany({
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
        select: dealSelect,
      });
      const seen = new Set<string>();
      const data = [];
      for (const listing of listings) {
        const key = `${listing.gameId}\u0000${listing.currency}`;
        if (seen.has(key)) continue;
        seen.add(key);
        data.push(serializeDeal(listing));
        if (data.length === parsed.data.limit) break;
      }
      response.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/deals/free', async (request, response, next) => {
    const parsed = parseLimit(request, freeDealsQuerySchema);
    if (!parsed.success) {
      invalidQuery(response, parsed.message);
      return;
    }

    try {
      const listings = await database.storeListing.findMany({
        where: {
          currentPrice: new Prisma.Decimal('0'),
          regularPrice: { gt: new Prisma.Decimal('0') },
          store: { is: { isActive: true } },
        },
        orderBy: [{ lastCheckedAt: 'desc' }, { id: 'asc' }],
        take: parsed.data.limit,
        select: dealSelect,
      });
      response.json({ data: listings.map(serializeDeal) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/deals/historical-lows', async (request, response, next) => {
    const parsed = parseLimit(request, historicalLowsQuerySchema);
    if (!parsed.success) {
      invalidQuery(response, parsed.message);
      return;
    }

    try {
      const snapshotGroups = await database.priceSnapshot.groupBy({
        by: ['listingId', 'currency'],
        where: { listing: { store: { isActive: true } } },
        _min: { price: true },
        _count: { _all: true },
      });
      const listingIds = [...new Set(snapshotGroups.map((group) => group.listingId))];
      if (listingIds.length === 0) {
        response.json({ data: [] });
        return;
      }

      const listings = await database.storeListing.findMany({
        where: { id: { in: listingIds }, store: { is: { isActive: true } } },
        orderBy: [{ currentPrice: 'asc' }, { id: 'asc' }],
        select: dealSelect,
      });
      const currentListings = new Map(listings.map((listing) => [listing.id, listing]));
      const historicalLows = snapshotGroups.flatMap((group) => {
        if (group._count._all < 2 || !group._min.price) return [];
        const listing = currentListings.get(group.listingId);
        if (
          !listing ||
          listing.currency !== group.currency ||
          listing.currentPrice.greaterThan(group._min.price)
        ) {
          return [];
        }
        return [
          {
            ...serializeDeal(listing),
            lowestRecordedPrice: moneyNumber(group._min.price) ?? 0,
          },
        ];
      });
      const data = historicalLows
        .sort(
          (left, right) =>
            left.lowestRecordedPrice - right.lowestRecordedPrice ||
            left.currentPrice - right.currentPrice ||
            left.id.localeCompare(right.id),
        )
        .slice(0, parsed.data.limit);
      response.json({ data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
