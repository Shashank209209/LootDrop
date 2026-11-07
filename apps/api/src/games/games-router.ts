import { Prisma, type PrismaClient } from '@prisma/client';
import {
  gameSearchQuerySchema,
  gameSlugSchema,
  priceHistoryQuerySchema,
  type GameSearchQuery,
  type PriceHistoryQuery,
} from '@dealhunter/contracts';
import { Router, type Request, type Response } from 'express';
import { moneyNumber } from '../pricing/deal-serialization.js';

type GamesDatabase = Pick<PrismaClient, 'game' | 'store' | 'priceSnapshot'>;

const maxHistoryPoints = 366;

function parseQuery<T>(
  request: Request,
  allowed: ReadonlySet<string>,
  schema: {
    safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: zodError };
  },
): { success: true; data: T } | { success: false; message: string } {
  const searchParams = new URL(request.originalUrl, 'http://localhost').searchParams;
  const raw: Record<string, string> = {};

  for (const key of new Set(searchParams.keys())) {
    if (!allowed.has(key)) return { success: false, message: `Unknown query parameter: ${key}` };
    const values = searchParams.getAll(key);
    if (values.length !== 1) {
      return { success: false, message: `Query parameter "${key}" may only be specified once` };
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

type zodError = { issues: Array<{ message: string }> };

function sendError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ error: { code, message, details: null } });
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function compareText(left: string, right: string) {
  return (
    left.toLocaleLowerCase().localeCompare(right.toLocaleLowerCase()) || left.localeCompare(right)
  );
}

function downsample<T extends { price: Prisma.Decimal; capturedAt: Date }>(points: T[]): T[] {
  if (points.length <= maxHistoryPoints) return points;

  let minimumIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (
      (points[index]?.price.toNumber() ?? Infinity) <
      (points[minimumIndex]?.price.toNumber() ?? Infinity)
    ) {
      minimumIndex = index;
    }
  }

  const selected = new Set([0, points.length - 1, minimumIndex]);
  const targetSize = maxHistoryPoints;
  for (let bucket = 1; selected.size < targetSize && bucket < targetSize * 2; bucket += 1) {
    selected.add(Math.round((bucket * (points.length - 1)) / (targetSize * 2)));
  }
  for (let index = 1; selected.size < targetSize && index < points.length - 1; index += 1) {
    selected.add(index);
  }
  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, targetSize)
    .map((index) => points[index]!)
    .sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
}

function historyFrom(range: PriceHistoryQuery['range'], now: Date): Date | null {
  if (range === 'all') return null;
  const days: Record<Exclude<PriceHistoryQuery['range'], 'all'>, number> = {
    '30d': 30,
    '90d': 90,
    '1y': 365,
  };
  return new Date(now.getTime() - days[range] * 24 * 60 * 60 * 1000);
}

export function createGamesRouter(database: GamesDatabase): Router {
  const router = Router();

  router.get('/games/search', async (request, response, next) => {
    const parsed = parseQuery(request, new Set(['q']), gameSearchQuerySchema);
    if (!parsed.success) {
      sendError(response, 400, 'INVALID_QUERY', parsed.message);
      return;
    }

    const query = parsed.data as GameSearchQuery;
    try {
      const games = await database.game.findMany({
        where: { title: { contains: escapeLike(query.q), mode: 'insensitive' } },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          slug: true,
          title: true,
          listings: {
            where: { store: { isActive: true } },
            select: {
              currentPrice: true,
              discountPercent: true,
              currency: true,
              store: { select: { isActive: true } },
            },
          },
        },
      });

      const prefix = query.q.toLocaleLowerCase();
      const results = games
        .map((game) => {
          const currency = [...new Set(game.listings.map((listing) => listing.currency))].sort(
            compareText,
          )[0];
          const bestListing = currency
            ? game.listings
                .filter((listing) => listing.currency === currency)
                .sort(
                  (left, right) =>
                    left.currentPrice.toNumber() - right.currentPrice.toNumber() ||
                    (right.discountPercent ?? -1) - (left.discountPercent ?? -1),
                )[0]
            : undefined;
          return {
            item: {
              id: game.id,
              slug: game.slug,
              title: game.title,
              bestPrice: bestListing ? moneyNumber(bestListing.currentPrice) : null,
              currency: bestListing?.currency ?? null,
              bestDiscountPercent: bestListing?.discountPercent ?? null,
            },
            startsWith: game.title.toLocaleLowerCase().startsWith(prefix),
          };
        })
        .sort(
          (left, right) =>
            Number(right.startsWith) - Number(left.startsWith) ||
            compareText(left.item.title, right.item.title) ||
            left.item.id.localeCompare(right.item.id),
        )
        .slice(0, 8)
        .map(({ item }) => item);

      response.json({ data: results });
    } catch (error) {
      next(error);
    }
  });

  router.get('/games/:slug/price-history', async (request, response, next) => {
    const slug = gameSlugSchema.safeParse(request.params.slug);
    if (!slug.success) {
      sendError(response, 400, 'INVALID_QUERY', 'Invalid game slug');
      return;
    }
    const parsed = parseQuery(request, new Set(['range', 'store']), priceHistoryQuerySchema);
    if (!parsed.success) {
      sendError(response, 400, 'INVALID_QUERY', parsed.message);
      return;
    }

    const query = parsed.data as PriceHistoryQuery;
    const now = new Date();
    const from = historyFrom(query.range, now);
    try {
      const [game, store] = await Promise.all([
        database.game.findUnique({
          where: { slug: slug.data },
          select: {
            listings: {
              where: {
                store: {
                  isActive: true,
                  ...(query.store ? { slug: query.store } : {}),
                },
              },
              orderBy: [{ store: { name: 'asc' } }, { id: 'asc' }],
              select: {
                id: true,
                currency: true,
                store: { select: { id: true, name: true, slug: true } },
                priceSnapshots: {
                  ...(from ? { where: { capturedAt: { gte: from } } } : {}),
                  orderBy: { capturedAt: 'asc' },
                  select: {
                    price: true,
                    regularPrice: true,
                    discountPercent: true,
                    capturedAt: true,
                  },
                },
              },
            },
          },
        }),
        query.store
          ? database.store.findUnique({ where: { slug: query.store }, select: { id: true } })
          : Promise.resolve(true),
      ]);
      if (!game) {
        sendError(response, 404, 'NOT_FOUND', 'Game not found');
        return;
      }
      if (query.store && !store) {
        sendError(response, 400, 'INVALID_QUERY', 'Unknown store slug');
        return;
      }

      const entries = game.listings.map((listing) => ({
        listingId: listing.id,
        store: listing.store,
        currency: listing.currency,
        points: downsample(listing.priceSnapshots).map((point) => ({
          capturedAt: point.capturedAt.toISOString(),
          price: moneyNumber(point.price) ?? 0,
          regularPrice: moneyNumber(point.regularPrice),
          discountPercent: point.discountPercent,
        })),
      }));
      const fromValue =
        from?.toISOString() ??
        entries
          .flatMap((entry) => entry.points)
          .map((point) => point.capturedAt)
          .sort()[0] ??
        null;

      response.json({
        data: entries,
        range: { from: fromValue, to: now.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/games/:slug', async (request, response, next) => {
    const slug = gameSlugSchema.safeParse(request.params.slug);
    if (!slug.success) {
      sendError(response, 400, 'INVALID_QUERY', 'Invalid game slug');
      return;
    }
    try {
      const game = await database.game.findUnique({
        where: { slug: slug.data },
        select: {
          id: true,
          slug: true,
          title: true,
          listings: {
            where: { store: { isActive: true } },
            orderBy: [
              { currency: 'asc' },
              { currentPrice: 'asc' },
              { store: { name: 'asc' } },
              { id: 'asc' },
            ],
            select: {
              id: true,
              currentPrice: true,
              regularPrice: true,
              discountPercent: true,
              currency: true,
              isOnSale: true,
              url: true,
              lastCheckedAt: true,
              store: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });
      if (!game) {
        sendError(response, 404, 'NOT_FOUND', 'Game not found');
        return;
      }

      const listingIds = game.listings.map((listing) => listing.id);
      const snapshots =
        listingIds.length > 0
          ? await database.priceSnapshot.groupBy({
              by: ['currency'],
              where: { listingId: { in: listingIds } },
              _min: { price: true },
              _max: { price: true },
              _count: { _all: true },
            })
          : [];
      const currencies = new Set(game.listings.map((listing) => listing.currency));
      const snapshotCurrencies = new Set(snapshots.map((group) => group.currency));
      const singleCurrency =
        currencies.size <= 1 &&
        snapshotCurrencies.size <= 1 &&
        (currencies.size === 0 ||
          snapshotCurrencies.size === 0 ||
          [...currencies][0] === [...snapshotCurrencies][0]);
      const summaryCurrency = singleCurrency
        ? ([...currencies][0] ?? [...snapshotCurrencies][0])
        : undefined;
      const matchingSnapshots = summaryCurrency
        ? snapshots.filter((group) => group.currency === summaryCurrency)
        : snapshots;
      const bestListing =
        singleCurrency && game.listings.length > 0
          ? game.listings.reduce((best, listing) =>
              listing.currentPrice.lessThan(best.currentPrice) ? listing : best,
            )
          : null;
      const minimum = matchingSnapshots.reduce<Prisma.Decimal | null>(
        (best, group) =>
          group._min.price && (!best || group._min.price.lessThan(best)) ? group._min.price : best,
        null,
      );
      const maximum = matchingSnapshots.reduce<Prisma.Decimal | null>(
        (best, group) =>
          group._max.price && (!best || group._max.price.greaterThan(best))
            ? group._max.price
            : best,
        null,
      );

      response.json({
        data: {
          game: { id: game.id, slug: game.slug, title: game.title },
          listings: game.listings.map((listing) => ({
            id: listing.id,
            store: listing.store,
            currentPrice: moneyNumber(listing.currentPrice) ?? 0,
            regularPrice: moneyNumber(listing.regularPrice),
            discountPercent: listing.discountPercent,
            currency: listing.currency,
            isOnSale: listing.isOnSale,
            dealUrl: listing.url,
            lastCheckedAt: listing.lastCheckedAt.toISOString(),
          })),
          summary: {
            bestListingId: bestListing?.id ?? null,
            lowestRecordedPrice: singleCurrency ? moneyNumber(minimum) : null,
            highestRecordedPrice: singleCurrency ? moneyNumber(maximum) : null,
            snapshotCount: snapshots.reduce((count, group) => count + group._count._all, 0),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
