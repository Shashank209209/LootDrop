import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RawgBudgetError, RawgQuotaError } from './adapter.js';
import { enrichMetadata } from './enrichment.js';
import { rawgDetailFixture, rawgSearchFixture } from './fixtures.js';

const game = { id: 'game-1', title: 'Celeste™: Deluxe Edition', slug: 'celeste' };
const empty = {
  rawgId: null,
  coverUrl: null,
  description: null,
  releaseDate: null,
  metacriticScore: null,
  userRating: null,
  _count: { genres: 0, platforms: 0 },
};

function setup() {
  const current = { ...empty, rawgId: null as number | null };
  const findMany = vi.fn(async (argument: { where: { listings: { some?: unknown } } }) =>
    current.rawgId === null && argument.where.listings.some ? [game] : [],
  );
  const tx = {
    $queryRaw: vi.fn(),
    game: {
      findUnique: vi.fn(async (arg: { where: { id?: string } }) => (arg.where.id ? current : null)),
      update: vi.fn(async ({ data }: { data: { rawgId: number } }) => {
        current.rawgId = data.rawgId;
      }),
    },
    genre: { upsert: vi.fn(async () => ({ id: 'genre-1' })) },
    gameGenre: { createMany: vi.fn() },
    platform: { findMany: vi.fn(async () => [{ id: 'pc-1' }, { id: 'mac-1' }]) },
    gamePlatform: { createMany: vi.fn() },
  };
  const database = {
    game: { findMany },
    $transaction: vi.fn(async (run: (db: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const keys = new Set<string>();
  const negativeCache = {
    find: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => keys.has(id)))),
    remember: vi.fn(async (id: string) => {
      keys.add(id);
    }),
  };
  const adapter = {
    requestsUsed: 2,
    searchGames: vi.fn(async () => ({ items: rawgSearchFixture.results, invalidItems: 0 })),
    getGame: vi.fn(async () => ({
      ...rawgDetailFixture,
      parent_platforms: [
        { platform: { id: 5, name: 'Apple Macintosh', slug: 'mac' } },
        { platform: { id: 2, name: 'PlayStation', slug: 'playstation' } },
      ],
    })),
  };
  const logger = { warn: vi.fn() };
  const run = (batchSize = 1, enabled = true) =>
    enrichMetadata({
      database: database as unknown as PrismaClient,
      ...(enabled ? { adapter } : {}),
      batchSize,
      logger,
      negativeCache,
    });
  return { run, current, findMany, tx, adapter, keys, negativeCache, logger };
}

describe('RAWG enrichment', () => {
  it('matches the exact normalized edition and writes all metadata and seeded platform links once', async () => {
    const { run, tx, findMany } = setup();
    await expect(run()).resolves.toMatchObject({
      examined: 1,
      matched: 1,
      requestsUsed: 2,
      samples: [{ slug: 'celeste', rawgId: 123 }],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rawgId: null, listings: { some: { isOnSale: true, store: { isActive: true } } } },
        orderBy: { id: 'asc' },
      }),
    );
    expect(tx.game.update).toHaveBeenCalledWith({
      where: { id: game.id },
      data: {
        rawgId: 123,
        coverUrl: rawgDetailFixture.background_image,
        description: rawgDetailFixture.description_raw,
        releaseDate: new Date('2018-01-25'),
        metacriticScore: 91,
        userRating: 4.2,
      },
    });
    expect(tx.genre.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'indie' },
        update: {},
      }),
    );
    expect(tx.gameGenre.createMany).toHaveBeenCalledWith({
      data: [{ gameId: game.id, genreId: 'genre-1' }],
      skipDuplicates: true,
    });
    expect(tx.platform.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['pc', 'macos'] } },
      select: { id: true },
    });
    await expect(run()).resolves.toMatchObject({ matched: 0 });
    expect(tx.game.update).toHaveBeenCalledOnce();
    expect(tx.gameGenre.createMany).toHaveBeenCalledOnce();
    expect(tx.gamePlatform.createMany).toHaveBeenCalledOnce();
  });

  it('preserves existing metadata and taxonomy links', async () => {
    const { run, tx } = setup();
    tx.game.findUnique.mockImplementation(async ({ where }) =>
      where.id
        ? ({
            rawgId: null,
            coverUrl: 'https://existing.example',
            description: 'Existing',
            releaseDate: new Date(),
            metacriticScore: 0,
            userRating: new Prisma.Decimal(0),
            _count: { genres: 1, platforms: 1 },
          } as never)
        : null,
    );
    await expect(run()).resolves.toMatchObject({ matched: 1 });
    expect(tx.game.update).toHaveBeenCalledWith({ where: { id: game.id }, data: { rawgId: 123 } });
    expect(tx.genre.upsert).not.toHaveBeenCalled();
    expect(tx.platform.findMany).not.toHaveBeenCalled();
  });

  it.each(['noMatch', 'ambiguous'] as const)('caches %s for seven days', async (reason) => {
    const { run, adapter, negativeCache, tx } = setup();
    adapter.searchGames.mockResolvedValue({
      items:
        reason === 'ambiguous'
          ? [
              ...rawgSearchFixture.results.slice(0, 1),
              { id: 987, name: 'Celeste Definitive', slug: 'second' },
            ]
          : rawgSearchFixture.results.slice(1),
      invalidItems: 1,
    });
    await expect(run()).resolves.toMatchObject({ [reason]: 1, invalidRecords: 1 });
    expect(adapter.getGame).not.toHaveBeenCalled();
    expect(tx.game.update).not.toHaveBeenCalled();
    expect(negativeCache.remember).toHaveBeenCalledWith(game.id, reason, 604800);
    await expect(run()).resolves.toMatchObject({ examined: 0, negativeCacheHits: 1 });
    expect(adapter.searchGames).toHaveBeenCalledOnce();
  });

  it('logs and caches a rawgId conflict without overwriting the game', async () => {
    const { run, tx, negativeCache, logger } = setup();
    tx.game.findUnique.mockImplementation(async ({ where }) =>
      where.id ? empty : ({ id: 'other' } as never),
    );
    await expect(run()).resolves.toMatchObject({ conflicts: 1, failed: 0 });
    expect(tx.game.update).not.toHaveBeenCalled();
    expect(negativeCache.remember).toHaveBeenCalledWith(game.id, 'conflicts', 604800);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('treats multiple exact response records as ambiguous even if they repeat an ID', async () => {
    const { run, adapter } = setup();
    const exact = rawgSearchFixture.results.slice(0, 1);
    adapter.searchGames.mockResolvedValue({ items: [...exact, ...exact], invalidItems: 0 });
    await expect(run()).resolves.toMatchObject({ ambiguous: 1, matched: 0 });
    expect(adapter.getGame).not.toHaveBeenCalled();
  });

  it('counts a uniqueness race as a conflict', async () => {
    const { run, tx } = setup();
    tx.game.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        meta: { target: ['rawg_id'] },
        clientVersion: 'test',
      }),
    );
    await expect(run()).resolves.toMatchObject({ conflicts: 1, failed: 0 });
  });

  it('caps the batch and stops on quota or request budget without caching a miss', async () => {
    const { run, findMany, adapter, negativeCache } = setup();
    const page = [game, { ...game, id: 'game-2' }];
    findMany.mockResolvedValue(page);
    adapter.searchGames.mockResolvedValue({ items: [], invalidItems: 0 });
    await expect(run(1)).resolves.toMatchObject({ examined: 1, noMatch: 1 });
    adapter.searchGames.mockRejectedValue(new RawgBudgetError());
    await expect(run(2)).resolves.toMatchObject({ stopped: 'budget', failed: 0 });
    adapter.searchGames.mockRejectedValue(new RawgQuotaError());
    await expect(run(2)).resolves.toMatchObject({ stopped: 'quota', failed: 0 });
    expect(negativeCache.remember).toHaveBeenCalledOnce();
  });

  it('exits without Prisma or RAWG queries when disabled', async () => {
    const { run, findMany, adapter, logger } = setup();
    await expect(run(1, false)).resolves.toMatchObject({ stopped: 'disabled', requestsUsed: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(adapter.searchGames).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
