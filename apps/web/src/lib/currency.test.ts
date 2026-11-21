import { describe, expect, it } from 'vitest';
import { convertPrice, formatCurrency } from './currency.js';

const rates = { USD: 1 as const, INR: 85.25, EUR: 0.895 };

describe('currency display', () => {
  it('converts from USD and between quoted currencies', () => {
    expect(convertPrice(10, 'USD', 'INR', rates)).toBe(852.5);
    expect(convertPrice(8.95, 'EUR', 'INR', rates)).toBe(852.5);
  });

  it('keeps free items free and rounds to cents', () => {
    expect(convertPrice(0, 'USD', 'EUR', rates)).toBe(0);
    expect(convertPrice(23, 'USD', 'EUR', rates)).toBe(20.59);
  });

  it('leaves same-currency prices alone and reports unavailable conversions', () => {
    expect(convertPrice(2.99, 'USD', 'USD')).toBe(2.99);
    expect(convertPrice(2.99, 'USD', 'EUR')).toBeNull();
    expect(convertPrice(2.99, 'JPY', 'USD', rates)).toBeNull();
    expect(convertPrice(2.99, 'USD', 'JPY', rates)).toBeNull();
    expect(convertPrice(Number.NaN, 'USD', 'EUR', rates)).toBeNull();
  });

  it.each([
    ['USD', '$123,456.78'],
    ['INR', '₹1,23,456.78'],
    ['EUR', '€123,456.78'],
  ])('formats %s with its display locale', (currency, text) => {
    expect(formatCurrency(123456.78, currency)).toBe(text);
  });
});
