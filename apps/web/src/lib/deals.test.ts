import { describe, expect, it } from 'vitest';
import { summarizeDeals } from './deals.js';

describe('summarizeDeals', () => {
  it('calculates totals, averages, and best deal values correctly', () => {
    const deals = [
      {
        id: 'deal-1',
        title: 'Hades',
        store: 'Steam',
        price: 6.99,
        regularPrice: 19.99,
        discountPercent: 65,
        isOnSale: true,
        image: null,
        url: 'https://example.com/hades',
        genre: 'Action Roguelike',
        releaseLabel: 'New release',
        rating: 4.9,
      },
      {
        id: 'deal-2',
        title: 'Stardew Valley',
        store: 'Steam',
        price: 4.99,
        regularPrice: 14.99,
        discountPercent: 67,
        isOnSale: true,
        image: null,
        url: 'https://example.com/stardew',
        genre: 'Simulation',
        releaseLabel: 'Popular now',
        rating: 4.8,
      },
      {
        id: 'deal-3',
        title: 'Cyberpunk 2077',
        store: 'Epic',
        price: 39.99,
        regularPrice: 59.99,
        discountPercent: 33,
        isOnSale: true,
        image: null,
        url: 'https://example.com/cyberpunk',
        genre: 'Open World',
        releaseLabel: 'Featured drop',
        rating: 4.5,
      },
      {
        id: 'deal-4',
        title: "Baldur's Gate 3",
        store: 'GOG',
        price: 49.99,
        regularPrice: 49.99,
        discountPercent: 0,
        isOnSale: false,
        image: null,
        url: 'https://example.com/baldurs-gate-3',
        genre: 'RPG',
        releaseLabel: 'Top ranked',
        rating: 4.9,
      },
    ];

    const summary = summarizeDeals(deals);

    expect(summary.totalDeals).toBe(4);
    expect(summary.onSaleCount).toBe(3);
    expect(summary.averageDiscount).toBe(55);
    expect(summary.cheapestPrice).toBe(4.99);
    expect(summary.bestDeal).not.toBeNull();
    if (!summary.bestDeal) throw new Error('Expected best deal to exist');
    expect(summary.bestDeal.title).toBe('Stardew Valley');
  });
});
