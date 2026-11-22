import { ratesResponseSchema, type RatesResponse } from '@lootdrop/contracts';
import { z } from 'zod';
import type { JsonCache } from '../pricing/cache.js';

const providerUrl = 'https://api.frankfurter.dev/v2/rates?base=usd&quotes=inr,eur&providers=ecb';
const freshSeconds = 24 * 60 * 60;
const lastKnownSeconds = 7 * freshSeconds;
const retryDelayMs = 30_000;
export const freshRatesKey = 'currency:rates:fresh';
export const lastKnownRatesKey = 'currency:rates:last-known';

const providerSchema = z
  .array(
    z.object({
      date: z.string().date(),
      base: z.literal('USD'),
      quote: z.enum(['INR', 'EUR']),
      rate: z.number().finite().positive(),
    }),
  )
  .length(2);
const cachedSchema = z.object({
  data: ratesResponseSchema.omit({ stale: true }),
  fetchedAt: z.number().finite().nonnegative(),
});
type CachedRates = z.infer<typeof cachedSchema>;
type RatesResult = {
  data: RatesResponse;
  cache: 'provider' | 'redis' | 'memory' | 'stale';
};

export class RatesService {
  private lastKnown: CachedRates | null = null;
  private retryAfter = 0;
  private inFlight: Promise<RatesResult | null> | null = null;

  constructor(
    private readonly cache: JsonCache,
    private readonly logger: { warn: (message: string) => void },
    private readonly fetchRates: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getRates(): Promise<RatesResult | null> {
    if (this.lastKnown && this.youngerThan(this.lastKnown, freshSeconds)) {
      return { data: { ...this.lastKnown.data, stale: false }, cache: 'memory' };
    }
    if (this.now() < this.retryAfter) return this.stale();
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private youngerThan(entry: CachedRates, seconds: number): boolean {
    const age = this.now() - entry.fetchedAt;
    return age >= 0 && age < seconds * 1000;
  }

  private stale(): RatesResult | null {
    if (!this.lastKnown || !this.youngerThan(this.lastKnown, lastKnownSeconds)) return null;
    return { data: { ...this.lastKnown.data, stale: true }, cache: 'stale' };
  }

  private async refresh(): Promise<RatesResult | null> {
    const fresh = await this.cache.get(freshRatesKey, cachedSchema).catch(() => null);
    if (fresh && this.youngerThan(fresh, freshSeconds)) {
      this.lastKnown = fresh;
      return { data: { ...fresh.data, stale: false }, cache: 'redis' };
    }

    const stored = await this.cache.get(lastKnownRatesKey, cachedSchema).catch(() => null);
    if (stored && (!this.lastKnown || stored.fetchedAt > this.lastKnown.fetchedAt)) {
      this.lastKnown = stored;
    }
    try {
      const response = await this.fetchRates(providerUrl, {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Reference rate request failed');
      const rows = providerSchema.parse(await response.json());
      const inr = rows.find((row) => row.quote === 'INR');
      const eur = rows.find((row) => row.quote === 'EUR');
      if (!inr || !eur || inr.date !== eur.date) throw new Error('Incomplete reference rates');
      const rates = { USD: 1 as const, INR: inr.rate, EUR: eur.rate };
      const previous = this.stale()?.data.rates;
      if (
        previous &&
        (['INR', 'EUR'] as const).some(
          (code) => rates[code] > previous[code] * 1.3 || rates[code] < previous[code] * 0.7,
        )
      ) {
        this.logger.warn(
          'Reference exchange rates changed by more than 30%; keeping last known rates',
        );
        this.retryAfter = this.now() + retryDelayMs;
        return this.stale();
      }
      const data = {
        base: 'USD' as const,
        rates,
        asOf: new Date(inr.date + 'T00:00:00Z').toISOString(),
        source: 'Frankfurter (European Central Bank)',
      };
      this.lastKnown = { data, fetchedAt: this.now() };
      await Promise.allSettled([
        this.cache.set(freshRatesKey, this.lastKnown, freshSeconds),
        this.cache.set(lastKnownRatesKey, this.lastKnown, lastKnownSeconds),
      ]);
      return { data: { ...data, stale: false }, cache: 'provider' };
    } catch {
      this.logger.warn('Reference exchange rates could not be refreshed');
      this.retryAfter = this.now() + retryDelayMs;
      return this.stale();
    }
  }
}
