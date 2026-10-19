import { describe, expect, it, vi } from 'vitest';
import type { JsonCache } from '../cache.js';
import type { RequestLimiter } from '../rate-limiter.js';
import { CheapSharkAdapter } from './adapter.js';

describe('CheapSharkAdapter', () => {
  it('sends bounded query params and the required User-Agent, then isolates malformed items', async () => {
    const cache: JsonCache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
    };
    const limiter: RequestLimiter = { waitForPermit: vi.fn(async () => undefined) };
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('pageNumber')).toBe('0');
      expect(url.searchParams.get('pageSize')).toBe('10');
      expect(url.searchParams.get('title')).toBe('The Witcher');
      expect(url.searchParams.get('onSale')).toBe('1');
      expect(new Headers(init?.headers).get('User-Agent')).toBe('DealHunter/0.1');
      return new Response(
        JSON.stringify([
          {
            dealID: 'deal-123',
            storeID: '1',
            gameID: '42',
            title: 'The Witcher',
            salePrice: '9.99',
            normalPrice: '19.99',
            savings: '50',
          },
          { dealID: 'malformed' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const adapter = new CheapSharkAdapter({
      cache,
      limiter,
      userAgent: 'DealHunter/0.1',
      fetchImpl,
    });

    const result = await adapter.fetchDeals({
      pageNumber: 0,
      pageSize: 10,
      title: 'The Witcher',
      onSale: true,
      sortBy: 'DealRating',
    });

    expect(result.items).toHaveLength(1);
    expect(result.invalidItems).toBe(1);
    expect(cache.set).toHaveBeenCalledOnce();
    expect(limiter.waitForPermit).toHaveBeenCalledOnce();
  });

  it('retries rate limits according to Retry-After', async () => {
    const limiter: RequestLimiter = { waitForPermit: vi.fn(async () => undefined) };
    const fetchImpl: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const adapter = new CheapSharkAdapter({
      cache: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
      limiter,
      userAgent: 'DealHunter/0.1',
      fetchImpl,
    });

    await expect(
      adapter.fetchDeals({ pageNumber: 0, pageSize: 1, sortBy: 'DealRating' }),
    ).resolves.toMatchObject({ items: [], invalidItems: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(limiter.waitForPermit).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable client errors', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response('', { status: 400 }));
    const adapter = new CheapSharkAdapter({
      cache: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
      limiter: { waitForPermit: vi.fn(async () => undefined) },
      userAgent: 'DealHunter/0.1',
      fetchImpl,
    });

    await expect(
      adapter.fetchDeals({ pageNumber: 0, pageSize: 1, sortBy: 'DealRating' }),
    ).rejects.toThrow('HTTP 400');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
