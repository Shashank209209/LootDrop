import { Prisma } from '@prisma/client';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { cheapSharkDealSchema, cheapSharkStoreSchema } from './cheapshark/schemas.js';
import { runCheapSharkDealSync } from './ingest-deals.js';

describe('runCheapSharkDealSync', () => {
  it('upserts a game and listing and captures the first observed price', async () => {
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
      fetchDeals: vi.fn(async () => ({
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
      })),
    };

    const result = await runCheapSharkDealSync(
      { pageNumber: 0, pageSize: 10, sortBy: 'DealRating' },
      {
        database: database as unknown as Parameters<typeof runCheapSharkDealSync>[1]['database'],
        adapter: adapter as never,
        logger: pino({ level: 'silent' }),
      },
    );

    expect(result).toEqual({ scrapeRunId: 'run-uuid', itemsProcessed: 1, itemsFailed: 0 });
    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(transaction.storeListing.upsert).toHaveBeenCalledOnce();
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
  });
});
