import { Prisma, type PrismaClient } from '@prisma/client';
import { wishlistAddRequestSchema, wishlistQuerySchema } from '@dealhunter/contracts';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { moneyNumber } from '../pricing/deal-serialization.js';
import { sendApiError } from '../http/api-error.js';
import { createRequireAuth } from '../auth/require-auth.js';

type WishlistDatabase = Pick<PrismaClient, '$transaction' | 'game' | 'storeListing' | 'wishlist'>;

const wishlistEntrySelect = {
  gameId: true,
  addedAt: true,
  game: { select: { slug: true, title: true } },
} satisfies Prisma.WishlistSelect;

const wishlistListingSelect = {
  gameId: true,
  currentPrice: true,
  regularPrice: true,
  discountPercent: true,
  currency: true,
  isOnSale: true,
  url: true,
  store: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.StoreListingSelect;

type WishlistEntryRecord = Prisma.WishlistGetPayload<{ select: typeof wishlistEntrySelect }>;
type WishlistListingRecord = Prisma.StoreListingGetPayload<{
  select: typeof wishlistListingSelect;
}>;

function getUserId(response: Response): string | null {
  const userId: unknown = response.locals.userId;
  return typeof userId === 'string' ? userId : null;
}

function parseWishlistQuery(request: Request) {
  const searchParams = new URL(request.originalUrl, 'http://localhost').searchParams;
  const raw: Record<string, string> = {};
  for (const key of new Set(searchParams.keys())) {
    if (key !== 'page' && key !== 'pageSize') {
      return { success: false as const, message: `Unknown query parameter: ${key}` };
    }
    const values = searchParams.getAll(key);
    if (values.length > 1) {
      return {
        success: false as const,
        message: `Query parameter "${key}" may only be specified once`,
      };
    }
    const value = values[0];
    if (value !== undefined) raw[key] = value;
  }
  const parsed = wishlistQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
    };
  }
  return { success: true as const, data: parsed.data };
}

function serializeBestListing(listing: WishlistListingRecord) {
  return {
    store: listing.store,
    currentPrice: moneyNumber(listing.currentPrice) ?? 0,
    regularPrice: moneyNumber(listing.regularPrice),
    discountPercent: listing.discountPercent,
    currency: listing.currency,
    isOnSale: listing.isOnSale,
    dealUrl: listing.url,
  };
}

export function createWishlistRouter(
  database: WishlistDatabase,
  accessSecret: string,
  issuer: string,
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(accessSecret, issuer);

  router.get('/ids', requireAuth, async (_request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    try {
      const entries = await database.wishlist.findMany({
        where: { userId },
        orderBy: [{ addedAt: 'desc' }, { gameId: 'asc' }],
        take: 1000,
        select: { gameId: true },
      });
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({ gameIds: entries.map((entry) => entry.gameId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const parsed = parseWishlistQuery(request);
    if (!parsed.success) {
      sendApiError(response, 400, 'INVALID_QUERY', parsed.message);
      return;
    }

    const { page, pageSize } = parsed.data;
    const where = { userId };
    try {
      const result = await database.$transaction(async (transaction) => {
        const [totalItems, entries] = await Promise.all([
          transaction.wishlist.count({ where }),
          transaction.wishlist.findMany({
            where,
            orderBy: [{ addedAt: 'desc' }, { gameId: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: wishlistEntrySelect,
          }),
        ]);
        const listings =
          entries.length === 0
            ? []
            : await transaction.storeListing.findMany({
                where: {
                  gameId: { in: entries.map((entry) => entry.gameId) },
                  store: { isActive: true },
                },
                orderBy: [{ currency: 'asc' }, { currentPrice: 'asc' }, { id: 'asc' }],
                select: wishlistListingSelect,
              });
        return { totalItems, entries, listings };
      });

      const bestByGame = new Map<string, WishlistListingRecord>();
      for (const listing of result.listings) {
        if (!bestByGame.has(listing.gameId)) bestByGame.set(listing.gameId, listing);
      }
      const totalPages = Math.ceil(result.totalItems / pageSize);
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({
        data: result.entries.map((entry: WishlistEntryRecord) => {
          const bestListing = bestByGame.get(entry.gameId);
          return {
            gameId: entry.gameId,
            gameSlug: entry.game.slug,
            gameTitle: entry.game.title,
            addedAt: entry.addedAt.toISOString(),
            bestListing: bestListing ? serializeBestListing(bestListing) : null,
          };
        }),
        pagination: {
          page,
          pageSize,
          totalItems: result.totalItems,
          totalPages,
          hasNextPage: page < totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const parsed = wishlistAddRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendApiError(
        response,
        400,
        'INVALID_REQUEST',
        parsed.error.issues.map((issue) => issue.message).join('; '),
      );
      return;
    }
    try {
      const game = await database.game.findUnique({
        where: { id: parsed.data.gameId },
        select: { id: true },
      });
      if (!game) {
        sendApiError(response, 404, 'NOT_FOUND', 'Game not found');
        return;
      }
      const result = await database.wishlist.createMany({
        data: [{ userId, gameId: parsed.data.gameId }],
        skipDuplicates: true,
      });
      response.status(result.count === 1 ? 201 : 200).json({
        gameId: parsed.data.gameId,
        added: result.count === 1,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:gameId', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const gameId = request.params.gameId;
    if (
      typeof gameId !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(gameId)
    ) {
      sendApiError(response, 400, 'INVALID_REQUEST', 'gameId must be a UUID');
      return;
    }
    try {
      await database.wishlist.deleteMany({ where: { userId, gameId } });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
