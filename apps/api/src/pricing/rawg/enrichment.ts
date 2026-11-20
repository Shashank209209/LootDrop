import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { normalizeGameTitle } from '../game-matcher.js';
import { RawgBudgetError, RawgQuotaError, type RawgAdapter } from './adapter.js';
import type { RawgGameDetail } from './schemas.js';

const NEGATIVE_TTL_SECONDS = 7 * 24 * 60 * 60;
const onSale = {
  isOnSale: true,
  store: { isActive: true },
} satisfies Prisma.StoreListingWhereInput;
const platformSlugs = new Map([
  ['pc', 'pc'],
  ['mac', 'macos'],
  ['macos', 'macos'],
  ['linux', 'linux'],
  ['playstation5', 'playstation-5'],
  ['playstation-5', 'playstation-5'],
  ['xbox-series-x', 'xbox-series-xs'],
  ['xbox-series-xs', 'xbox-series-xs'],
  ['nintendo-switch', 'nintendo-switch'],
]);

type NegativeReason = 'noMatch' | 'ambiguous' | 'conflicts';
type Candidate = { id: string; title: string; slug: string };
type Database = Pick<PrismaClient, 'game' | '$transaction'>;
type Adapter = Pick<RawgAdapter, 'requestsUsed' | 'searchGames' | 'getGame'>;

export interface NegativeCache {
  find(gameIds: string[]): Promise<Set<string>>;
  remember(gameId: string, reason: NegativeReason, seconds: number): Promise<void>;
}

interface EnrichmentOptions {
  database: Database;
  adapter?: Adapter;
  negativeCache: NegativeCache;
  logger: Pick<Logger, 'warn'>;
  batchSize: number;
}

function releaseDate(value?: string | null): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const date = new Date(value);
  if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return date;
}

function coverUrl(value?: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    // Malformed cover URLs should not prevent saving other fields.
  }
}

function duplicateRawgId(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const target = error.meta?.target;
  return Array.isArray(target) && target.some((field) => field === 'rawg_id' || field === 'rawgId');
}

async function saveMetadata(database: Database, id: string, detail: RawgGameDetail) {
  try {
    return await database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM games WHERE id = ${id}::uuid FOR UPDATE`;
      const game = await tx.game.findUnique({
        where: { id },
        select: {
          rawgId: true,
          coverUrl: true,
          description: true,
          releaseDate: true,
          metacriticScore: true,
          userRating: true,
          _count: { select: { genres: true, platforms: true } },
        },
      });
      if (!game || game.rawgId !== null) return 'unchanged';
      if (await tx.game.findUnique({ where: { rawgId: detail.id }, select: { id: true } })) {
        return 'conflicts';
      }

      const data: Prisma.GameUpdateInput = { rawgId: detail.id };
      const cover = coverUrl(detail.background_image);
      const description = detail.description_raw?.trim();
      const released = releaseDate(detail.released);
      if (!game.coverUrl && cover) data.coverUrl = cover;
      if (!game.description && description) data.description = description;
      if (game.releaseDate === null && released) data.releaseDate = released;
      if (
        game.metacriticScore === null &&
        detail.metacritic != null &&
        Number.isInteger(detail.metacritic) &&
        detail.metacritic >= 0 &&
        detail.metacritic <= 100
      ) {
        data.metacriticScore = detail.metacritic;
      }
      if (
        game.userRating === null &&
        detail.rating != null &&
        detail.rating >= 0 &&
        detail.rating <= 5
      ) {
        data.userRating = detail.rating;
      }
      await tx.game.update({ where: { id }, data });

      if (game._count.genres === 0) {
        const links = [];
        for (const genre of [...detail.genres].sort((a, b) => a.slug.localeCompare(b.slug))) {
          const slug = genre.slug === 'role-playing-games-rpg' ? 'rpg' : genre.slug;
          if (slug.length > 120 || genre.name.length > 100) continue;
          const { id: genreId } = await tx.genre.upsert({
            where: { slug },
            create: { slug, name: genre.name, rawgId: genre.id },
            update: {},
            select: { id: true },
          });
          links.push({ gameId: id, genreId });
        }
        if (links.length) await tx.gameGenre.createMany({ data: links, skipDuplicates: true });
      }

      if (game._count.platforms === 0) {
        const slugs = new Set<string>();
        for (const { platform } of [
          ...(detail.platforms ?? []),
          ...(detail.parent_platforms ?? []),
        ]) {
          const slug = platformSlugs.get(platform.slug);
          if (slug) slugs.add(slug);
        }
        if (slugs.size) {
          const platforms = await tx.platform.findMany({
            where: { slug: { in: [...slugs] } },
            select: { id: true },
          });
          if (platforms.length) {
            await tx.gamePlatform.createMany({
              data: platforms.map(({ id: platformId }) => ({ gameId: id, platformId })),
              skipDuplicates: true,
            });
          }
        }
      }
      return 'matched';
    });
  } catch (error) {
    if (duplicateRawgId(error)) return 'conflicts';
    throw error;
  }
}

export async function enrichMetadata({
  database,
  adapter,
  negativeCache,
  logger,
  batchSize,
}: EnrichmentOptions) {
  const result = {
    examined: 0,
    matched: 0,
    noMatch: 0,
    ambiguous: 0,
    conflicts: 0,
    failed: 0,
    invalidRecords: 0,
    negativeCacheHits: 0,
    unchanged: 0,
    requestsUsed: 0,
    stopped: null as 'disabled' | 'quota' | 'budget' | null,
    samples: [] as { slug: string; rawgId: number }[],
    doubtful: [] as {
      slug: string;
      reason: NegativeReason | 'invalidDetail';
      candidateIds: number[];
    }[],
  };
  if (!adapter) {
    logger.warn('RAWG_API_KEY is missing; metadata enrichment is disabled');
    result.stopped = 'disabled';
    return result;
  }

  async function reject(game: Candidate, reason: NegativeReason, candidateIds: number[]) {
    await negativeCache.remember(game.id, reason, NEGATIVE_TTL_SECONDS);
    result[reason]++;
    result.doubtful.push({ slug: game.slug, reason, candidateIds });
    if (reason === 'conflicts')
      logger.warn({ gameId: game.id, candidateIds }, 'RAWG ID is already assigned');
  }

  const pageSize = Math.max(25, batchSize);
  salePriority: for (const listings of [{ some: onSale }, { none: onSale }]) {
    let lastId: string | undefined;
    while (result.examined < batchSize) {
      const page: Candidate[] = await database.game.findMany({
        where: { rawgId: null, listings, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: 'asc' },
        take: pageSize,
        select: { id: true, slug: true, title: true },
      });
      if (!page.length) break;
      lastId = page.at(-1)?.id;
      const cached = await negativeCache.find(page.map(({ id }) => id));
      for (const game of page) {
        if (result.examined >= batchSize) break salePriority;
        if (cached.has(game.id)) {
          result.negativeCacheHits++;
          continue;
        }
        result.examined++;
        try {
          const normalizedTitle = normalizeGameTitle(game.title);
          const search = await adapter.searchGames(game.title);
          result.invalidRecords += search.invalidItems;
          const exactIds = [
            ...new Set(
              search.items
                .filter(
                  ({ name }) => normalizedTitle && normalizeGameTitle(name) === normalizedTitle,
                )
                .map(({ id }) => id),
            ),
          ];
          const [rawgId] = exactIds;
          if (exactIds.length !== 1 || rawgId === undefined) {
            await reject(game, exactIds.length ? 'ambiguous' : 'noMatch', exactIds);
            continue;
          }

          const detail = await adapter.getGame(rawgId);
          if (detail.id !== rawgId || normalizeGameTitle(detail.name) !== normalizedTitle) {
            result.failed++;
            result.invalidRecords++;
            result.doubtful.push({
              slug: game.slug,
              reason: 'invalidDetail',
              candidateIds: exactIds,
            });
            continue;
          }
          const outcome = await saveMetadata(database, game.id, detail);
          if (outcome === 'conflicts') {
            await reject(game, outcome, exactIds);
          } else {
            result[outcome]++;
            if (outcome === 'matched' && result.samples.length < 3) {
              result.samples.push({ slug: game.slug, rawgId });
            }
          }
        } catch (error) {
          if (error instanceof RawgBudgetError || error instanceof RawgQuotaError) {
            result.stopped = error instanceof RawgBudgetError ? 'budget' : 'quota';
            if (result.stopped === 'quota')
              logger.warn('RAWG quota or access limit reached; ending enrichment');
            break salePriority;
          }
          result.failed++;
          logger.warn({ gameId: game.id }, 'RAWG metadata enrichment failed for game');
        }
      }
      if (page.length < pageSize) break;
    }
  }
  result.requestsUsed = adapter.requestsUsed;
  return result;
}
