export interface GameMatchCandidate {
  id: string;
  normalizedTitle: string;
  steamAppId: number | null;
}

export interface GameMatchTarget {
  title: string;
  steamAppId: number | null;
}

const editionWords =
  /\b(?:game\s+of\s+the\s+year|goty|deluxe|definitive|ultimate|complete|collector'?s|edition)\b/giu;

export function normalizeGameTitle(title: string): string {
  return title
    .replace(/[\u2122\u00AE\u00A9]/g, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(editionWords, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findMatchingGame<T extends GameMatchCandidate>(
  candidates: readonly T[],
  target: GameMatchTarget,
): T | null {
  if (target.steamAppId !== null) {
    return candidates.find((candidate) => candidate.steamAppId === target.steamAppId) ?? null;
  }

  const normalizedTitle = normalizeGameTitle(target.title);
  return candidates.find((candidate) => candidate.normalizedTitle === normalizedTitle) ?? null;
}
