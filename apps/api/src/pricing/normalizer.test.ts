import { describe, expect, it } from 'vitest';
import { cheapSharkDealSchema, cheapSharkStoreSchema } from './cheapshark/schemas.js';
import { normalizeCheapSharkDeal, normalizeCheapSharkStore } from './normalizer.js';

describe('CheapShark normalization', () => {
  it('converts the current deals response fields into the internal price contract', () => {
    const deal = cheapSharkDealSchema.parse({
      dealID: 'deal-123',
      storeID: '1',
      gameID: '332562',
      title: 'The Witcher 3: Wild Hunt Remastered',
      salePrice: '24.99',
      normalPrice: '49.99',
      savings: '50.010002',
      isOnSale: '1',
      steamAppID: '292030',
      releaseDate: 1790640000,
      metacriticScore: '92',
      thumb: 'https://example.com/cover.jpg',
    });

    expect(normalizeCheapSharkDeal(deal)).toMatchObject({
      sourceDealId: 'deal-123',
      sourceStoreId: '1',
      sourceGameId: '332562',
      normalizedTitle: 'the witcher 3 wild hunt remastered',
      steamAppId: 292030,
      salePrice: 24.99,
      regularPrice: 49.99,
      discountPercent: 50,
      isOnSale: true,
      currency: 'USD',
      url: 'https://www.cheapshark.com/redirect?dealID=deal-123',
      metacriticScore: 92,
    });
  });

  it('normalizes provider stores with relative logos', () => {
    const store = cheapSharkStoreSchema.parse({
      storeID: '1',
      storeName: 'Steam',
      isActive: 1,
      images: { logo: '/img/stores/logos/0.png' },
    });

    expect(normalizeCheapSharkStore(store)).toEqual({
      cheapsharkStoreId: '1',
      name: 'Steam',
      slug: 'steam',
      logoUrl: 'https://www.cheapshark.com/img/stores/logos/0.png',
      isActive: true,
    });
  });

  it('rejects malformed deals without throwing from the batch parser', () => {
    expect(cheapSharkDealSchema.safeParse({ dealID: 'broken' }).success).toBe(false);
  });
});
