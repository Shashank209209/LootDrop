import {
  displayCurrencySchema,
  type CurrencyRates,
  type DisplayCurrency,
} from '@dealhunter/contracts';

const currencyStorageKey = 'lootdrop.currency';
// Use familiar grouping and symbols for the three display currencies.
const locale = { USD: 'en-US', INR: 'en-IN', EUR: 'en-IE' } as const;
const formatters = new Map<string, Intl.NumberFormat>();

export function convertPrice(
  amount: number,
  original: string,
  target: string,
  rates?: CurrencyRates | null,
): number | null {
  const from = displayCurrencySchema.safeParse(original);
  const to = displayCurrencySchema.safeParse(target);
  if (!Number.isFinite(amount) || !from.success || !to.success) return null;
  if (from.data === to.data) return amount;
  if (!rates) return null;
  const value = (amount / rates[from.data]) * rates[to.data];
  const cents = (Math.abs(value) + Number.EPSILON) * 100;
  return Number.isFinite(cents) ? Math.sign(value) * (Math.round(cents) / 100) : null;
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    let formatter = formatters.get(currency);
    if (!formatter) {
      const supported = displayCurrencySchema.safeParse(currency);
      formatter = new Intl.NumberFormat(supported.success ? locale[supported.data] : undefined, {
        style: 'currency',
        currency,
      });
      formatters.set(currency, formatter);
    }
    return formatter.format(amount);
  } catch {
    return currency + ' ' + amount.toFixed(2);
  }
}

export function readGuestCurrency(): DisplayCurrency {
  try {
    return displayCurrencySchema
      .catch('USD')
      .parse(window.localStorage.getItem(currencyStorageKey));
  } catch {
    return 'USD';
  }
}

export function writeGuestCurrency(currency: DisplayCurrency) {
  try {
    window.localStorage.setItem(currencyStorageKey, currency);
  } catch {
    // The selected currency remains available for the current visit.
  }
}
