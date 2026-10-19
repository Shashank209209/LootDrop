import { describe, expect, it } from 'vitest';
import { hasPriceChanged, type PriceState } from './price-snapshot.js';

const unchangedPrice: PriceState = {
  currentPrice: '19.990',
  regularPrice: '39.99',
  discountPercent: 50,
  currency: 'USD',
};

describe('hasPriceChanged', () => {
  it('captures the first observed price', () => {
    expect(hasPriceChanged(null, unchangedPrice)).toBe(true);
  });

  it('does not create a snapshot for equivalent decimal values', () => {
    expect(
      hasPriceChanged(unchangedPrice, {
        currentPrice: 19.99,
        regularPrice: 39.99,
        discountPercent: 50,
        currency: 'USD ',
      }),
    ).toBe(false);
  });

  it('captures sale, regular-price, discount, and currency changes', () => {
    expect(hasPriceChanged(unchangedPrice, { ...unchangedPrice, currentPrice: 14.99 })).toBe(true);
    expect(hasPriceChanged(unchangedPrice, { ...unchangedPrice, regularPrice: 29.99 })).toBe(true);
    expect(hasPriceChanged(unchangedPrice, { ...unchangedPrice, discountPercent: 63 })).toBe(true);
    expect(hasPriceChanged(unchangedPrice, { ...unchangedPrice, currency: 'EUR' })).toBe(true);
  });
});
