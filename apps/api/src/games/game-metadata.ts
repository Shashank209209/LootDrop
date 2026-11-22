import type { Prisma } from '@prisma/client';
import type { GameMetadata } from '@lootdrop/contracts';

const taxonomySelect = { slug: true, name: true } as const;

export const gameMetadataSelect = {
  coverUrl: true,
  releaseDate: true,
  metacriticScore: true,
  userRating: true,
  genres: {
    orderBy: { genre: { slug: 'asc' } },
    select: { genre: { select: taxonomySelect } },
  },
  platforms: {
    orderBy: { platform: { slug: 'asc' } },
    select: { platform: { select: taxonomySelect } },
  },
} satisfies Prisma.GameSelect;

export function serializeGameMetadata(
  game: Prisma.GameGetPayload<{ select: typeof gameMetadataSelect }>,
): GameMetadata {
  return {
    coverUrl: game.coverUrl,
    genres: game.genres.map(({ genre }) => genre),
    platforms: game.platforms.map(({ platform }) => platform),
    releaseDate: game.releaseDate?.toISOString().slice(0, 10) ?? null,
    metacriticScore: game.metacriticScore,
    userRating: game.userRating?.toNumber() ?? null,
  };
}
