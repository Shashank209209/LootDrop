import { describe, expect, it, vi } from 'vitest';
import type { JsonCache } from '../pricing/cache.js';
import { freshRatesKey, lastKnownRatesKey, RatesService } from './rates-service.js';

const day = 86_400_000;
const rows = [
  { base: 'USD', quote: 'EUR', date: '2026-11-20', rate: 0.87, extra: 'internal' },
  { base: 'USD', quote: 'INR', date: '2026-11-20', rate: 85.2 },
];

function setup() {
  const stored = new Map<string, { value: unknown; expires: number }>();
  let now = day;
  const get = vi.fn<JsonCache['get']>(async (key, schema) => {
    const entry = stored.get(key);
    return entry && entry.expires > now ? schema.parse(entry.value) : null;
  });
  const set = vi.fn<JsonCache['set']>(async (key, value, seconds) => {
    stored.set(key, { value, expires: now + seconds * 1000 });
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(rows));
  const logger = { warn: vi.fn() };
  const makeService = () => new RatesService({ get, set }, logger, fetch, () => now);
  return {
    fetch,
    logger,
    get,
    set,
    makeService,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('RatesService', () => {
  it('validates the provider response, exposes only the public shape and stores the two TTLs', async () => {
    const { fetch, set, makeService } = setup();
    expect(await makeService().getRates()).toEqual({
      cache: 'provider',
      data: {
        base: 'USD',
        rates: { USD: 1, INR: 85.2, EUR: 0.87 },
        asOf: '2026-11-20T00:00:00.000Z',
        source: 'Frankfurter (European Central Bank)',
        stale: false,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('base=usd'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(set).toHaveBeenCalledWith(freshRatesKey, expect.anything(), 86400);
    expect(set).toHaveBeenCalledWith(lastKnownRatesKey, expect.anything(), 604800);
  });

  it('uses memory in the same process and Redis across restarts without a provider request', async () => {
    const { fetch, get, makeService } = setup();
    const service = makeService();
    await service.getRates();
    expect(await service.getRates()).toMatchObject({ cache: 'memory' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(await makeService().getRates()).toMatchObject({ cache: 'redis' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('refreshes at 24 hours even after reading an almost expired shared cache', async () => {
    const { fetch, advance, makeService } = setup();
    await makeService().getRates();
    advance(day - 10);
    const service = makeService();
    expect(await service.getRates()).toMatchObject({ cache: 'redis' });
    advance(10);
    expect(await service.getRates()).toMatchObject({ cache: 'provider' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('serves stale after a timeout, then expires last known rates after a week', async () => {
    const { fetch, advance, makeService } = setup();
    await makeService().getRates();
    advance(day);
    fetch.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const service = makeService();
    expect(await service.getRates()).toMatchObject({ cache: 'stale', data: { stale: true } });
    await service.getRates();
    expect(fetch).toHaveBeenCalledTimes(2);
    advance(6 * day);
    expect(await service.getRates()).toBeNull();
  });

  it('reports unavailable if the provider fails and the cache is empty', async () => {
    const { fetch, makeService } = setup();
    fetch.mockResolvedValue(new Response('', { status: 502 }));
    await expect(makeService().getRates()).resolves.toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid rate %s',
    async (rate) => {
      const { fetch, makeService, set } = setup();
      fetch.mockResolvedValue(Response.json([rows[0], { ...rows[1], rate }]));
      expect(await makeService().getRates()).toBeNull();
      expect(set).not.toHaveBeenCalled();
    },
  );

  it.each(
    [
      [rows[0], rows[0]],
      [rows[0], { ...rows[1], base: 'EUR' }],
      { internal: 'invalid payload' },
    ].map((payload) => [payload]),
  )('rejects a malformed or incomplete provider reply', async (payload) => {
    const { fetch, makeService } = setup();
    fetch.mockResolvedValue(Response.json(payload));
    expect(await makeService().getRates()).toBeNull();
  });

  it('rejects an implausible change and keeps the previously published date', async () => {
    const { fetch, set, logger, makeService, advance } = setup();
    await makeService().getRates();
    advance(day);
    fetch.mockResolvedValue(Response.json([rows[0], { ...rows[1], rate: 130 }]));
    expect(await makeService().getRates()).toMatchObject({
      cache: 'stale',
      data: { rates: { INR: 85.2 }, asOf: '2026-11-20T00:00:00.000Z', stale: true },
    });
    expect(set).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('30%'));
  });

  it('coalesces concurrent cold starts into one refresh', async () => {
    const { makeService, fetch, get } = setup();
    const service = makeService();
    const responses = await Promise.all([
      service.getRates(),
      service.getRates(),
      service.getRates(),
    ]);
    expect(responses.every((response) => response?.cache === 'provider')).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
