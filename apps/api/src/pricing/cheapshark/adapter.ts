import { createHash } from 'node:crypto';
import type { JsonCache } from '../cache.js';
import type {
  DealSyncQuery,
  NormalizedStore,
  PriceSourceAdapter,
  SourceBatch,
} from '../contracts.js';
import { normalizeCheapSharkStore } from '../normalizer.js';
import type { RequestLimiter } from '../rate-limiter.js';
import {
  cheapSharkDealSchema,
  cheapSharkDealsResponseSchema,
  cheapSharkStoreSchema,
  cheapSharkStoresResponseSchema,
  type CheapSharkDeal,
  type CheapSharkStore,
} from './schemas.js';

const API_BASE_URL = 'https://www.cheapshark.com/api/1.0';
const DEAL_CACHE_TTL_SECONDS = 120;
const STORE_CACHE_TTL_SECONDS = 86_400;
const MAX_RETRIES = 3;

class NonRetryableProviderError extends Error {}

export interface CheapSharkAdapterConfig {
  cache: JsonCache;
  limiter: RequestLimiter;
  userAgent: string;
  fetchImpl?: typeof fetch;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
}

function cacheKey(path: string, query?: object): string {
  const queryHash = createHash('sha256')
    .update(JSON.stringify(query ?? {}))
    .digest('hex');
  return `cheapshark:${path}:${queryHash}`;
}

export class CheapSharkAdapter implements PriceSourceAdapter<DealSyncQuery, CheapSharkDeal> {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CheapSharkAdapterConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async fetchDeals(query: DealSyncQuery): Promise<SourceBatch<CheapSharkDeal>> {
    const key = cacheKey('deals', query);
    const cached = await this.config.cache.get(key, cheapSharkDealsResponseSchema);
    if (cached) return this.validateDeals(cached);

    const url = new URL(`${API_BASE_URL}/deals`);
    url.searchParams.set('pageNumber', String(query.pageNumber));
    url.searchParams.set('pageSize', String(query.pageSize));
    url.searchParams.set('sortBy', query.sortBy);
    if (query.storeID) url.searchParams.set('storeID', query.storeID);
    if (query.title) url.searchParams.set('title', query.title);
    if (query.steamAppID !== undefined)
      url.searchParams.set('steamAppID', String(query.steamAppID));
    if (query.onSale !== undefined) url.searchParams.set('onSale', query.onSale ? '1' : '0');
    if (query.upperPrice !== undefined)
      url.searchParams.set('upperPrice', String(query.upperPrice));

    const payload = await this.getJson(url);
    const parsed = cheapSharkDealsResponseSchema.parse(payload);
    await this.config.cache.set(key, parsed, DEAL_CACHE_TTL_SECONDS);
    return this.validateDeals(parsed);
  }

  async fetchStores(): Promise<SourceBatch<NormalizedStore>> {
    const key = cacheKey('stores');
    const cached = await this.config.cache.get(key, cheapSharkStoresResponseSchema);
    const payload =
      cached ??
      cheapSharkStoresResponseSchema.parse(await this.getJson(new URL(`${API_BASE_URL}/stores`)));
    if (!cached) await this.config.cache.set(key, payload, STORE_CACHE_TTL_SECONDS);

    const items: NormalizedStore[] = [];
    let invalidItems = 0;
    for (const value of payload) {
      const parsed = cheapSharkStoreSchema.safeParse(value);
      if (!parsed.success) {
        invalidItems += 1;
        continue;
      }
      items.push(normalizeCheapSharkStore(parsed.data as CheapSharkStore));
    }
    return { items, invalidItems };
  }

  private validateDeals(payload: unknown[]): SourceBatch<CheapSharkDeal> {
    const items: CheapSharkDeal[] = [];
    let invalidItems = 0;
    for (const value of payload) {
      const parsed = cheapSharkDealSchema.safeParse(value);
      if (!parsed.success) {
        invalidItems += 1;
        continue;
      }
      items.push(parsed.data);
    }
    return { items, invalidItems };
  }

  private async getJson(url: URL): Promise<unknown> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.config.limiter.waitForPermit();

      try {
        const response = await this.fetchImpl(url, {
          headers: { 'User-Agent': this.config.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });

        if (response.status === 429 || response.status >= 500) {
          if (attempt === MAX_RETRIES) {
            throw new Error(`CheapShark request failed with HTTP ${response.status}`);
          }
          const retryAfter = retryAfterMilliseconds(response.headers.get('retry-after'));
          await sleep(retryAfter ?? 250 * 2 ** attempt);
          continue;
        }
        if (!response.ok) {
          throw new NonRetryableProviderError(
            `CheapShark request failed with HTTP ${response.status}`,
          );
        }
        return await response.json();
      } catch (error) {
        if (error instanceof NonRetryableProviderError) throw error;
        if (attempt === MAX_RETRIES) throw error;
        await sleep(250 * 2 ** attempt);
      }
    }

    throw new Error('CheapShark request exhausted retries');
  }
}
