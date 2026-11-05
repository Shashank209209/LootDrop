import { Prisma } from '@prisma/client';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { cheapSharkDealSchema, cheapSharkStoreSchema } from './cheapshark/schemas.js';
import { runCheapSharkDealSync } from './ingest-deals.js';

describe('runCheapSharkDealSync', () => {
  it('rejects a page cap outside the supported bound', async () => {
    const database = {
      scrapeRun: { create: vi.fn() },
    };

    await expect(
      runCheapSharkDealSync(
        { pageNumber: 0, pageSize: 1, sortBy: 'DealRating' },
        {
          database: database as unknown as Parameters<typeof runCheapSharkDealSync>[1]['database'],
          adapter: {} as never,
          logger: pino({ level: 'silent' }),
          source: 'MANUAL',
          maxPages: 11,
        },
      ),
    ).rejects.toThrow('maxPages must be an integer between 1 and 10');
    expect(database.scrapeRun.create).not.toHaveBeenCalled();
  });

  it('upserts a game and listing and captures the first observed price across bounded pages', async () => {
    const store = { id: 'store-uuid', cheapsharkStoreId: '1' };
    const game = {
      id: 'game-uuid',
      cheapsharkGameId: null,
      coverUrl: null,
      releaseDate: null,
      metacriticScore: null,
    };
    const snapshotCreate = vi.fn(async () => ({ id: 1n }));
    const transaction = {
      store: { findUnique: vi.fn(async () => store) },
      game: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => game),
        update: vi.fn(async () => game),
      },
      storeListing: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({ id: 'listing-uuid' })),
      },
      priceSnapshot: { create: snapshotCreate },
    };
    const scrapeRun = { id: 'run-uuid' };
    const database = {
      scrapeRun: {
        create: vi.fn(async () => scrapeRun),
        update: vi.fn(async () => scrapeRun),
      },
      store: {
        findUnique: vi.fn(async () => store),
        update: vi.fn(async () => store),
        create: vi.fn(async () => store),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const adapter = {
      fetchStores: vi.fn(async () => ({
        items: [
          cheapSharkStoreSchema.parse({
            storeID: '1',
            storeName: 'Steam',
            isActive: 1,
            images: { logo: '/steam.png' },
          }),
        ],
        invalidItems: 0,
      })),
      fetchDeals: vi
        .fn()
        .mockResolvedValueOnce({
          items: [
            cheapSharkDealSchema.parse({
              dealID: 'deal-uuid',
              storeID: '1',
              gameID: 'game-source-id',
              title: 'Test Game',
              salePrice: '9.99',
              normalPrice: '19.99',
              savings: '50',
              steamAppID: '42',
            }),
          ],
          invalidItems: 0,
        })
        .mockResolvedValueOnce({
          items: [
            cheapSharkDealSchema.parse({
              dealID: 'deal-uuid-2',
              storeID: '1',
              gameID: 'game-source-id-2',
              title: 'Second Test Game',
              salePrice: '4.99',
              normalPrice: '9.99',
              savings: '50',
              steamAppID: '43',
            }),
          ],
          invalidItems: 0,
        }),
    };

    const result = await runCheapSharkDealSync(
      { pageNumber: 0, pageSize: 1, sortBy: 'DealRating' },
      {
        database: database as unknown as Parameters<typeof runCheapSharkDealSync>[1]['database'],
        adapter: adapter as never,
        logger: pino({ level: 'silent' }),
        source: 'MANUAL',
        maxPages: 2,
      },
    );

    expect(result).toEqual({
      scrapeRunId: 'run-uuid',
      pagesFetched: 2,
      itemsProcessed: 2,
      itemsFailed: 0,
    });
    expect(adapter.fetchDeals).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pageNumber: 0, pageSize: 1 }),
    );
    expect(adapter.fetchDeals).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageNumber: 1, pageSize: 1 }),
    );
    expect(adapter.fetchDeals).toHaveBeenCalledTimes(2);
    expect(database.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.storeListing.upsert).toHaveBeenCalledTimes(2);
    expect(snapshotCreate).toHaveBeenCalledWith({
      data: {
        listingId: 'listing-uuid',
        price: new Prisma.Decimal('9.99'),
        regularPrice: new Prisma.Decimal('19.99'),
        discountPercent: 50,
        currency: 'USD',
      },
    });
    expect(database.scrapeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    );
    expect(database.scrapeRun.create).toHaveBeenCalledWith({
      data: { provider: 'cheapshark', source: 'MANUAL', status: 'RUNNING' },
    });
  });

  it('logs and records invalid store and deal counts', async () => {
    const scrapeRun = { id: 'run-uuid' };
    const database = {
      scrapeRun: {
        create: vi.fn(async () => scrapeRun),
        update: vi.fn(async () => scrapeRun),
      },
    };
    const adapter = {
      fetchStores: vi.fn(async () => ({ items: [], invalidItems: 1 })),
      fetchDeals: vi.fn(async () => ({ items: [], invalidItems: 2 })),
    };
    const logLines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line) => logLines.push(line) });

    const result = await runCheapSharkDealSync(
      { pageNumber: 0, pageSize: 10, sortBy: 'DealRating' },
      {
        database: database as unknown as Parameters<typeof runCheapSharkDealSync>[1]['database'],
        adapter: adapter as never,
        logger,
        source: 'MANUAL',
      },
    );

    expect(result).toEqual({
      scrapeRunId: 'run-uuid',
      pagesFetched: 1,
      itemsProcessed: 0,
      itemsFailed: 3,
    });
    expect(database.scrapeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', itemsProcessed: 0, itemsFailed: 3 }),
      }),
    );
    expect(logLines.map((line) => JSON.parse(line).msg)).toContain(
      'CheapShark stores failed validation',
    );
    expect(logLines.map((line) => JSON.parse(line).msg)).toContain(
      'CheapShark deals failed validation',
    );
  });

  it('logs and records a provider failure before rethrowing it', async () => {
    const scrapeRun = { id: 'run-uuid' };
    const database = {
      scrapeRun: {
        create: vi.fn(async () => scrapeRun),
        update: vi.fn(async () => scrapeRun),
      },
    };
    const adapter = {
      fetchStores: vi.fn(async () => {
        throw new Error('CheapShark unavailable');
      }),
    };
    const logLines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line) => logLines.push(line) });

    await expect(
      runCheapSharkDealSync(
        { pageNumber: 0, pageSize: 10, sortBy: 'DealRating' },
        {
          database: database as unknown as Parameters<typeof runCheapSharkDealSync>[1]['database'],
          adapter: adapter as never,
          logger,
          source: 'SCHEDULED',
        },
      ),
    ).rejects.toThrow('CheapShark unavailable');

    expect(database.scrapeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', itemsProcessed: 0, itemsFailed: 1 }),
      }),
    );
    expect(database.scrapeRun.create).toHaveBeenCalledWith({
      data: { provider: 'cheapshark', source: 'SCHEDULED', status: 'RUNNING' },
    });
    expect(logLines.map((line) => JSON.parse(line).msg)).toContain('CheapShark deal sync failed');
  });

  it('rejects and logs free deals without a positive regular price', async () => {
    const scrapeRun = { id: 'run-uuid' };
    const database = {
      scrapeRun: {
        create: vi.fn(async () => scrapeRun),
        update: vi.fn(async () => scrapeRun),
      },
    };
    const adapter = {
      fetchStores: vi.fn(async () => ({ items: [], invalidItems: 0 })),
      fetchDeals: vi.fn(async () => ({
        items: [
          cheapSharkDealSchema.parse({
            dealID: 'free-without-reference-price',
            storeID: '1',
            gameID: '1',
            title: 'Invalid Free Game',
            salePrice: '0',
            normalPrice: '0',
          }),
        ],
        invalidItems: 0,
      })),
    };
    const logLines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line) => logLines.push(line) });

    const result = await runCheapSharkDealSync(
      { pageNumber: 0, pageSize: 10, sortBy: 'DealRating' },
      {
        database: database as unknown as Parameters<typeof runCheapSharkDealSync>[1]['database'],
        adapter: adapter as never,
        logger,
        source: 'MANUAL',
      },
    );

    expect(result).toMatchObject({ itemsProcessed: 0, itemsFailed: 1 });
    expect(database.scrapeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', itemsProcessed: 0, itemsFailed: 1 }),
      }),
    );
    expect(logLines.map((line) => JSON.parse(line).msg)).toContain('Failed to ingest deal');
    expect(logLines.map((line) => JSON.parse(line).err?.message).filter(Boolean)).toContain(
      'CheapShark returned a zero salePrice without a positive normalPrice',
    );
  });
});
