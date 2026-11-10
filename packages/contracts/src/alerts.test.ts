import { describe, expect, it } from 'vitest';
import {
  alertsQuerySchema,
  createAlertRequestSchema,
  notificationsQuerySchema,
  updateAlertRequestSchema,
} from './alerts.js';

const gameId = '20da2e1d-c56e-4874-8e7c-f5d15d38d502';

describe('alert contracts', () => {
  it('accepts each alert type with only its applicable target', () => {
    const shared = { gameId, currency: 'USD' };
    expect(
      createAlertRequestSchema.safeParse({
        ...shared,
        alertType: 'PRICE_BELOW',
        targetPrice: 0.01,
      }).success,
    ).toBe(true);
    expect(
      createAlertRequestSchema.safeParse({
        ...shared,
        alertType: 'DISCOUNT_ABOVE',
        targetDiscountPercent: 100,
      }).success,
    ).toBe(true);
    expect(createAlertRequestSchema.safeParse({ ...shared, alertType: 'ANY_SALE' }).success).toBe(
      true,
    );
    expect(
      createAlertRequestSchema.safeParse({ ...shared, alertType: 'HISTORICAL_LOW' }).success,
    ).toBe(true);
  });

  it('rejects invalid price targets, discounts, currencies, and irrelevant target fields', () => {
    const base = { gameId, alertType: 'PRICE_BELOW' };
    for (const targetPrice of [0, -1, 10_000.01, 12.345]) {
      expect(
        createAlertRequestSchema.safeParse({ ...base, targetPrice, currency: 'USD' }).success,
      ).toBe(false);
    }
    expect(
      createAlertRequestSchema.safeParse({
        gameId,
        alertType: 'DISCOUNT_ABOVE',
        targetDiscountPercent: 101,
      }).success,
    ).toBe(false);
    expect(
      createAlertRequestSchema.safeParse({
        gameId,
        alertType: 'PRICE_BELOW',
        targetPrice: 10,
        currency: 'usd',
      }).success,
    ).toBe(false);
    expect(
      createAlertRequestSchema.safeParse({
        gameId,
        alertType: 'ANY_SALE',
        targetPrice: 10,
      }).success,
    ).toBe(false);
  });

  it('defaults the alert currency and paginates with a maximum page size of 50', () => {
    expect(
      createAlertRequestSchema.parse({
        gameId,
        alertType: 'ANY_SALE',
      }),
    ).toMatchObject({ currency: 'USD' });
    expect(alertsQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(alertsQuerySchema.safeParse({ pageSize: '51' }).success).toBe(false);
    expect(notificationsQuerySchema.parse({ unreadOnly: 'true' }).unreadOnly).toBe(true);
  });

  it('requires at least one valid patch field and rejects unknown fields', () => {
    expect(updateAlertRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAlertRequestSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateAlertRequestSchema.safeParse({ targetPrice: 5, extra: true }).success).toBe(false);
  });
});
