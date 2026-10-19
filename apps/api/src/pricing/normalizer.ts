import type { CheapSharkDeal, CheapSharkStore } from './cheapshark/schemas.js';
import type { NormalizedDeal, NormalizedStore } from './contracts.js';
import { normalizeGameTitle } from './game-matcher.js';

const CHEAPSHARK_BASE_URL = 'https://www.cheapshark.com';

function parseNonNegativePrice(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`CheapShark returned an invalid ${field}`);
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function optionalInteger(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isInteger(value) ? value : null;
}

function optionalSteamAppId(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeCheapSharkDeal(deal: CheapSharkDeal): NormalizedDeal {
  const salePrice = parseNonNegativePrice(deal.salePrice, 'salePrice');
  const regularPrice =
    deal.normalPrice === undefined || deal.normalPrice === null
      ? null
      : parseNonNegativePrice(deal.normalPrice, 'normalPrice');
  const discountPercent =
    deal.savings === undefined || deal.savings === null || !Number.isFinite(deal.savings)
      ? null
      : Math.max(0, Math.min(100, Math.round(deal.savings)));
  const releaseTimestamp = deal.releaseDate;
  const releaseDate =
    releaseTimestamp === undefined || releaseTimestamp === null || releaseTimestamp <= 0
      ? null
      : new Date(releaseTimestamp * 1000);
  const steamAppId = optionalSteamAppId(deal.steamAppID);
  const isOnSale = deal.isOnSale === true || deal.isOnSale === 1 || deal.isOnSale === '1';

  return {
    sourceDealId: deal.dealID,
    sourceGameId: deal.gameID,
    sourceStoreId: deal.storeID,
    title: deal.title,
    normalizedTitle: normalizeGameTitle(deal.title),
    steamAppId,
    salePrice,
    regularPrice,
    discountPercent,
    isOnSale,
    currency: 'USD',
    url: `${CHEAPSHARK_BASE_URL}/redirect?dealID=${encodeURIComponent(deal.dealID)}`,
    coverUrl: deal.thumb || null,
    releaseDate: releaseDate && Number.isNaN(releaseDate.getTime()) ? null : releaseDate,
    metacriticScore: optionalInteger(deal.metacriticScore),
  };
}

function slugify(value: string): string {
  return normalizeGameTitle(value).replace(/\s+/g, '-').slice(0, 110) || 'store';
}

export function normalizeCheapSharkStore(store: CheapSharkStore): NormalizedStore {
  const logoPath = store.images?.logo;
  return {
    cheapsharkStoreId: store.storeID,
    name: store.storeName,
    slug: slugify(store.storeName),
    logoUrl: logoPath ? new URL(logoPath, CHEAPSHARK_BASE_URL).toString() : null,
    isActive: store.isActive === true || store.isActive === 1,
  };
}
