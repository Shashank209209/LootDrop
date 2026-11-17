import { describe, expect, it, vi } from 'vitest';
import type { JsonCache } from '../cache.js';
import type { RequestLimiter } from '../rate-limiter.js';
import { rawgDetailFixture, rawgSearchFixture } from './fixtures.js';
import { RawgAdapter, RawgQuotaError, RawgRequestError, RawgValidationError } from './adapter.js';

function createAdapter(
  fetchImpl: typeof fetch,
  cacheValues = new Map<string, unknown>(),
  sleepImpl = vi.fn(async () => {}),
) {
  const cache: JsonCache = {
    get: vi.fn(async (key, schema) => {
      const value = cacheValues.get(key);
      if (value === undefined) return null;
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }),
    set: vi.fn(async (key, value) => {
      cacheValues.set(key, value);
    }),
  };
  const limiter: RequestLimiter = { waitForPermit: vi.fn(async () => {}) };
  return {
    adapter: new RawgAdapter({ apiKey: '', cache, limiter, fetchImpl, sleepImpl }),
    cache,
    limiter,
    sleepImpl,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('RawgAdapter', () => {
  it('uses the documented precise-search parameters and validates records', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/games');
      expect(url.searchParams.get('search')).toBe('Celeste');
      expect(url.searchParams.get('search_precise')).toBe('true');
      expect(url.searchParams.get('page_size')).toBe('5');
      return jsonResponse(rawgSearchFixture);
    }) as typeof fetch;
    const { adapter } = createAdapter(fetchImpl);

    await expect(adapter.searchGames('Celeste')).resolves.toEqual({
      items: rawgSearchFixture.results,
      invalidItems: 0,
    });
    expect(adapter.requestsUsed).toBe(1);
  });

  it('returns an empty search result and skips malformed records', async () => {
    const { adapter: emptyAdapter } = createAdapter(
      vi.fn(async () => jsonResponse({ results: [] })) as typeof fetch,
    );
    await expect(emptyAdapter.searchGames('missing')).resolves.toEqual({
      items: [],
      invalidItems: 0,
    });

    const { adapter } = createAdapter(
      vi.fn(async () =>
        jsonResponse({ results: [{ id: 'bad', name: 'Broken' }, ...rawgSearchFixture.results] }),
      ) as typeof fetch,
    );
    await expect(adapter.searchGames('Celeste')).resolves.toMatchObject({
      items: rawgSearchFixture.results,
      invalidItems: 1,
    });
  });

  it('validates detail responses and reads the plain-text description field', async () => {
    const { adapter } = createAdapter(
      vi.fn(async () => jsonResponse(rawgDetailFixture)) as typeof fetch,
    );
    const detail = await adapter.getGame(123);
    expect(detail.description_raw).toBe(rawgDetailFixture.description_raw);
    expect(detail.rating).toBe(4.2);
    expect(detail.platforms).toEqual(rawgDetailFixture.platforms);
  });

  it('stops immediately on quota responses and does not retry', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'quota' }, 429)) as typeof fetch;
    const { adapter, sleepImpl } = createAdapter(fetchImpl);
    await expect(adapter.searchGames('Celeste')).rejects.toBeInstanceOf(RawgQuotaError);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('retries server errors and request timeouts with exponential backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(jsonResponse(rawgSearchFixture)) as typeof fetch;
    const { adapter, sleepImpl } = createAdapter(fetchImpl);
    await adapter.searchGames('Celeste');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, 250);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, 500);
  });

  it('does not expose request URLs in errors and rejects malformed details', async () => {
    const failing = createAdapter(vi.fn(async () => jsonResponse({}, 400)) as typeof fetch).adapter;
    await expect(failing.searchGames('Celeste')).rejects.toThrow(RawgRequestError);
    await expect(failing.searchGames('Celeste')).rejects.not.toThrow(/key=/i);

    const malformed = createAdapter(
      vi.fn(async () => jsonResponse({ id: 'bad' })) as typeof fetch,
    ).adapter;
    await expect(malformed.getGame(123)).rejects.toBeInstanceOf(RawgValidationError);
  });
});
