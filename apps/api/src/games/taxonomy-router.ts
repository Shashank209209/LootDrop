import type { Prisma, PrismaClient } from '@prisma/client';
import { Router } from 'express';

const onSale = {
  listings: { some: { isOnSale: true, store: { isActive: true } } },
} satisfies Prisma.GameWhereInput;
const select = { id: true, slug: true, name: true } as const;
const orderBy = [{ name: 'asc' }, { slug: 'asc' }] as const;

function withCounts(
  rows: { id: string; slug: string; name: string }[],
  counts: Map<string, number>,
) {
  return rows.flatMap(({ id, name, slug }) => {
    const dealCount = counts.get(id) ?? 0;
    return dealCount > 0 ? [{ slug, name, dealCount }] : [];
  });
}

export function createTaxonomyRouter(
  database: Pick<PrismaClient, 'gameGenre' | 'genre' | 'gamePlatform' | 'platform'>,
): Router {
  const router = Router();

  router.get('/genres', async (_request, response, next) => {
    try {
      const groups = await database.gameGenre.groupBy({
        by: ['genreId'],
        where: { game: onSale },
        _count: { _all: true },
      });
      const counts = new Map(groups.map((group) => [group.genreId, group._count._all]));
      const rows = counts.size
        ? await database.genre.findMany({
            where: { id: { in: [...counts.keys()] } },
            select,
            orderBy: [...orderBy],
          })
        : [];
      response.json({ data: withCounts(rows, counts) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/platforms', async (_request, response, next) => {
    try {
      const groups = await database.gamePlatform.groupBy({
        by: ['platformId'],
        where: { game: onSale },
        _count: { _all: true },
      });
      const counts = new Map(groups.map((group) => [group.platformId, group._count._all]));
      const rows = counts.size
        ? await database.platform.findMany({
            where: { id: { in: [...counts.keys()] } },
            select,
            orderBy: [...orderBy],
          })
        : [];
      response.json({ data: withCounts(rows, counts) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
