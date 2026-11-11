import { describe, expect, it } from 'vitest';
import {
  evaluateAlerts,
  type AlertToEvaluate,
  type ListingToEvaluate,
  type SnapshotToEvaluate,
} from './evaluator.js';

const now = new Date('2026-11-10T12:00:00.000Z');

function alert(overrides: Partial<AlertToEvaluate> = {}): AlertToEvaluate {
  return {
    id: 'alert-1',
    gameId: 'game-1',
    storeId: null,
    alertType: 'PRICE_BELOW',
    targetPrice: 10,
    targetDiscountPercent: null,
    currency: 'USD',
    isActive: true,
    lastTriggeredAt: null,
    lastConditionMet: null,
    ...overrides,
  };
}

function listing(overrides: Partial<ListingToEvaluate> = {}): ListingToEvaluate {
  return {
    id: 'listing-1',
    gameId: 'game-1',
    storeId: 'store-1',
    currentPrice: 9,
    regularPrice: 20,
    discountPercent: 55,
    currency: 'USD',
    isOnSale: true,
    lastCheckedAt: now,
    ...overrides,
  };
}

function evaluate(
  alertOverrides: Partial<AlertToEvaluate> = {},
  listings: ListingToEvaluate[] = [listing()],
  snapshots: SnapshotToEvaluate[] = [],
  evaluationTime = now,
) {
  return evaluateAlerts({
    alerts: [alert(alertOverrides)],
    listings,
    snapshots,
    now: evaluationTime,
  });
}

describe('evaluateAlerts', () => {
  it('fires PRICE_BELOW at the boundary, including a free listing', () => {
    expect(evaluate({ targetPrice: 9 }, [listing({ currentPrice: 9 })]).fired).toHaveLength(1);
    expect(evaluate({ targetPrice: 0 }, [listing({ currentPrice: 0 })]).fired).toHaveLength(1);
    expect(evaluate({ targetPrice: 8 }).fired).toHaveLength(0);
  });

  it('fires DISCOUNT_ABOVE at its boundary and ignores missing or lower discounts', () => {
    expect(
      evaluate({ alertType: 'DISCOUNT_ABOVE', targetPrice: null, targetDiscountPercent: 55 }, [
        listing({ discountPercent: 55 }),
      ]).fired,
    ).toHaveLength(1);
    expect(
      evaluate({ alertType: 'DISCOUNT_ABOVE', targetPrice: null, targetDiscountPercent: 56 }, [
        listing({ discountPercent: 55 }),
      ]).fired,
    ).toHaveLength(0);
    expect(
      evaluate({ alertType: 'DISCOUNT_ABOVE', targetPrice: null, targetDiscountPercent: 55 }, [
        listing({ discountPercent: null }),
      ]).fired,
    ).toHaveLength(0);
  });

  it('fires ANY_SALE only for listings currently marked on sale', () => {
    expect(evaluate({ alertType: 'ANY_SALE', targetPrice: null }, [listing()]).fired).toHaveLength(
      1,
    );
    expect(
      evaluate({ alertType: 'ANY_SALE', targetPrice: null }, [listing({ isOnSale: false })]).fired,
    ).toHaveLength(0);
  });

  it('fires HISTORICAL_LOW only when the listing has at least two same-currency snapshots', () => {
    const historicalLowAlert = {
      alertType: 'HISTORICAL_LOW' as const,
      targetPrice: null,
      targetDiscountPercent: null,
    };
    const points = [{ listingId: 'listing-1', currency: 'USD', count: 2, lowestPrice: 9 }];
    expect(
      evaluate(
        historicalLowAlert,
        [listing()],
        [{ listingId: 'listing-1', currency: 'USD', count: 1, lowestPrice: 9 }],
      ).fired,
    ).toHaveLength(0);
    expect(evaluate(historicalLowAlert, [listing()], points).fired).toHaveLength(1);
    expect(
      evaluate(
        historicalLowAlert,
        [listing()],
        [...points, { listingId: 'other', currency: 'EUR', count: 2, lowestPrice: 1 }],
      ).fired,
    ).toHaveLength(1);
  });

  it('uses the scoped store or the cheapest same-currency listing for any store', () => {
    const listings = [
      listing({ id: 'listing-expensive', storeId: 'store-1', currentPrice: 11 }),
      listing({ id: 'listing-cheapest', storeId: 'store-2', currentPrice: 8 }),
      listing({ id: 'listing-eur', storeId: 'store-3', currentPrice: 1, currency: 'EUR' }),
    ];
    expect(evaluate({}, listings).fired[0]?.listing.id).toBe('listing-cheapest');
    expect(evaluate({ storeId: 'store-1' }, listings).fired).toHaveLength(0);
  });

  it('does not compare prices across currencies', () => {
    const result = evaluate({ currency: 'USD' }, [listing({ currency: 'EUR', currentPrice: 1 })]);
    expect(result.evaluated).toBe(0);
    expect(result.fired).toHaveLength(0);
  });

  it('ignores inactive alerts and respects the 24-hour cooldown', () => {
    expect(evaluate({ isActive: false }).evaluated).toBe(0);
    expect(
      evaluate(
        {
          lastTriggeredAt: new Date(now.getTime() - 23 * 60 * 60 * 1000),
          lastConditionMet: false,
        },
        [listing()],
      ).fired,
    ).toHaveLength(0);
  });

  it('does not refire while the condition stays true at the same price', () => {
    expect(evaluate({ lastConditionMet: true }).fired).toHaveLength(0);
  });

  it('re-arms after a false evaluation and fires again after the cooldown', () => {
    const first = evaluate(
      { lastConditionMet: true, lastTriggeredAt: new Date(now.getTime() - 25 * 60 * 60 * 1000) },
      [listing({ currentPrice: 11 })],
    );
    expect(first.fired).toHaveLength(0);
    expect(first.stateUpdates[0]).toMatchObject({ conditionMet: false });

    const rearmed = evaluate(
      {
        lastConditionMet: first.stateUpdates[0]?.conditionMet ?? null,
        lastTriggeredAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      },
      [listing({ currentPrice: 9 })],
      [],
      new Date(now.getTime() + 1),
    );
    expect(rearmed.fired).toHaveLength(1);
  });
});
