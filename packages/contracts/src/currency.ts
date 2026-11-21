import { z } from 'zod';

export const displayCurrencies = ['USD', 'INR', 'EUR'] as const;
export const displayCurrencySchema = z.enum(displayCurrencies);
export type DisplayCurrency = z.infer<typeof displayCurrencySchema>;

export const currencyRatesSchema = z.object({
  USD: z.literal(1),
  INR: z.number().finite().positive(),
  EUR: z.number().finite().positive(),
});

export const ratesResponseSchema = z.object({
  base: z.literal('USD'),
  rates: currencyRatesSchema,
  asOf: z.string().datetime(),
  source: z.string(),
  stale: z.boolean(),
});

export const preferenceSchema = z.object({ preferredCurrency: displayCurrencySchema }).strict();
export type CurrencyRates = z.infer<typeof currencyRatesSchema>;
export type RatesResponse = z.infer<typeof ratesResponseSchema>;
