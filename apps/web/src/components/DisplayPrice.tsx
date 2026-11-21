import { convertPrice, formatCurrency } from '../lib/currency.js';
import { useCurrency } from './CurrencyProvider.js';

export function DisplayPrice({ amount, original }: { amount: number; original: string }) {
  const { currency, rates } = useCurrency();
  const converted =
    currency === original ? null : convertPrice(amount, original, currency, rates?.rates);
  return converted === null ? (
    <>{formatCurrency(amount, original)}</>
  ) : (
    <span title={formatCurrency(amount, original) + ' ' + original}>
      ≈{formatCurrency(converted, currency)}
    </span>
  );
}
