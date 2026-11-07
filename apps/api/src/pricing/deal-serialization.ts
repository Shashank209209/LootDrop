import { Prisma } from '@prisma/client';

export const dealSelect = {
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
} satisfies Prisma.StoreListingSelect;

export type SelectedDealListing = Prisma.StoreListingGetPayload<{ select: typeof dealSelect }>;

export function moneyNumber(value: Prisma.Decimal | null): number | null {
  if (value === null) return null;
  return Math.round((value.toNumber() + Number.EPSILON) * 100) / 100;
}

export function serializeDeal(listing: SelectedDealListing) {
  return {
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
  };
}
