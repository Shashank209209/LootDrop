import { createHash } from 'node:crypto';
import type { JsonCache } from '../cache.js';
import type { RequestLimiter } from '../rate-limiter.js';
import {
  rawgGameDetailSchema,
  rawgSearchRecordSchema,
  rawgSearchResponseSchema,
  type RawgGameDetail,
  type RawgSearchRecord,
} from './schemas.js';

const API_BASE_URL = 'https://api.rawg.io/api';
const SEARCH_CACHE_TTL_SECONDS = 86_400;
const DETAIL_CACHE_TTL_SECONDS = 30 * 86_400;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 3;

export class RawgQuotaError extends Error {
  constructor() {
    super('RAWG quota or access limit reached; stopping enrichment for this run');
    this.name = 'RawgQuotaError';
  }
}

export class RawgRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawgRequestError';
  }
}

export class RawgValidationError extends Error {
  constructor() {
    super('RAWG returned a malformed game detail record');
    this.name = 'RawgValidationError';
  }
}

export interface RawgAdapterConfig {
  apiKey: string;
  cache: JsonCache;
  limiter: RequestLimiter;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
}

export interface RawgSearchBatch {
  items: RawgSearchRecord[];
  invalidItems: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cacheKey(kind: string, value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `rawg:${kind}:${hash}`;
}

export class RawgAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (milliseconds: number) => Promise<void>;
  private networkRequests = 0;

  constructor(private readonly config: RawgAdapterConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleepImpl = config.sleepImpl ?? sleep;
  }

  get requestsUsed(): number {
    return this.networkRequests;
  }

  async searchGames(title: string): Promise<RawgSearchBatch> {
    const key = cacheKey('search', title);
    const cached = await this.config.cache.get(key, rawgSearchResponseSchema);
    const payload =
      cached ??
      rawgSearchResponseSchema.parse(
        await this.getJson('/games', { search: title, search_precise: 'true', page_size: '5' }),
      );
    if (!cached) await this.config.cache.set(key, payload, SEARCH_CACHE_TTL_SECONDS);

    const items: RawgSearchRecord[] = [];
    let invalidItems = 0;
    for (const result of payload.results) {
      const parsed = rawgSearchRecordSchema.safeParse(result);
      if (parsed.success) items.push(parsed.data);
      else invalidItems += 1;
    }
    return { items, invalidItems };
  }

  async getGame(id: number): Promise<RawgGameDetail> {
    const key = cacheKey('game', String(id));
    const cached = await this.config.cache.get<RawgGameDetail>(key, rawgGameDetailSchema);
    if (cached) return cached;

    const payload = await this.getJson(`/games/${id}`);
    const parsed = rawgGameDetailSchema.safeParse(payload);
    if (!parsed.success) throw new RawgValidationError();
    await this.config.cache.set(key, parsed.data, DETAIL_CACHE_TTL_SECONDS);
    return parsed.data;
  }

  private async getJson(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${API_BASE_URL}${path}`);
    url.searchParams.set('key', this.config.apiKey);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.config.limiter.waitForPermit();
      this.networkRequests += 1;

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (attempt === MAX_RETRIES) {
          throw new RawgRequestError('RAWG request timed out or failed');
        }
        await this.sleepImpl(250 * 2 ** attempt);
        continue;
      }

      if (response.status === 429 || response.status === 403) throw new RawgQuotaError();
      if (response.status >= 500) {
        if (attempt === MAX_RETRIES) {
          throw new RawgRequestError(`RAWG request failed with HTTP ${response.status}`);
        }
        await this.sleepImpl(250 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        throw new RawgRequestError(`RAWG request failed with HTTP ${response.status}`);
      }
      try {
        return await response.json();
      } catch {
        throw new RawgRequestError('RAWG returned invalid JSON');
      }
    }

    throw new RawgRequestError('RAWG request exhausted retries');
  }
}
