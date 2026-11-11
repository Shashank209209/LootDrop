import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { normalizeCheapSharkDeal } from './normalizer.js';
import { findMatchingGame } from './game-matcher.js';
import type { CheapSharkAdapter } from './cheapshark/adapter.js';
import { capturePriceSnapshotIfChanged, type PriceState } from './price-snapshot.js';
import type { DealSyncQuery } from './contracts.js';

type Database = Pick<
  PrismaClient,
  'scrapeRun' | 'store' | 'game' | 'storeListing' | '$transaction'
>;

function safeSlug(title: string, sourceGameId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 250);
  const suffix = sourceGameId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50) || 'source';
  return `${base || 'game'}-${suffix}`.slice(0, 320);
}

async function findOrCreateGame(
  transaction: Prisma.TransactionClient,
  deal: ReturnType<typeof normalizeCheapSharkDeal>,
) {
  let existing = null;
  if (deal.steamAppId !== null) {
    existing = await transaction.game.findUnique({ where: { steamAppId: deal.steamAppId } });
  } else {
    const candidates = await transaction.game.findMany({
      where: { normalizedTitle: deal.normalizedTitle },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    existing = findMatchingGame(candidates, { title: deal.title, steamAppId: null });
  }

  if (existing) {
    return transaction.game.update({
      where: { id: existing.id },
      data: {
        cheapsharkGameId: existing.cheapsharkGameId ?? deal.sourceGameId,
        coverUrl: existing.coverUrl ?? deal.coverUrl,
        releaseDate: existing.releaseDate ?? deal.releaseDate,
        metacriticScore: existing.metacriticScore ?? deal.metacriticScore,
      },
    });
  }

  return transaction.game.create({
    data: {
      title: deal.title,
      slug: safeSlug(deal.title, deal.sourceGameId),
      normalizedTitle: deal.normalizedTitle,
      steamAppId: deal.steamAppId,
      cheapsharkGameId: deal.sourceGameId,
      coverUrl: deal.coverUrl,
      releaseDate: deal.releaseDate,
      metacriticScore: deal.metacriticScore,
    },
  });
}

async function persistDeal(
  database: Database,
  deal: ReturnType<typeof normalizeCheapSharkDeal>,
): Promise<string> {
  return database.$transaction(async (transaction) => {
    const store = await transaction.store.findUnique({
      where: { cheapsharkStoreId: deal.sourceStoreId },
    });
    if (!store) throw new Error(`CheapShark store ${deal.sourceStoreId} was not synchronized`);

    const game = await findOrCreateGame(transaction, deal);
    const previousListing = await transaction.storeListing.findUnique({
      where: {
        storeId_storeGameId: {
          storeId: store.id,
          storeGameId: deal.sourceGameId,
        },
      },
    });
    const nextPrice: PriceState = {
      currentPrice: deal.salePrice,
      regularPrice: deal.regularPrice,
      discountPercent: deal.discountPercent,
      currency: deal.currency,
    };
    const listing = await transaction.storeListing.upsert({
      where: {
        storeId_storeGameId: {
          storeId: store.id,
          storeGameId: deal.sourceGameId,
        },
      },
      create: {
        gameId: game.id,
        storeId: store.id,
        storeGameId: deal.sourceGameId,
        url: deal.url,
        currentPrice: new Prisma.Decimal(deal.salePrice),
        regularPrice: deal.regularPrice === null ? null : new Prisma.Decimal(deal.regularPrice),
        discountPercent: deal.discountPercent,
        currency: deal.currency,
        isOnSale: deal.isOnSale,
        lastCheckedAt: new Date(),
      },
      update: {
        gameId: game.id,
        url: deal.url,
        currentPrice: new Prisma.Decimal(deal.salePrice),
        regularPrice: deal.regularPrice === null ? null : new Prisma.Decimal(deal.regularPrice),
        discountPercent: deal.discountPercent,
        currency: deal.currency,
        isOnSale: deal.isOnSale,
        lastCheckedAt: new Date(),
      },
    });

    await capturePriceSnapshotIfChanged(transaction, listing.id, previousListing, nextPrice);
    return listing.id;
  });
}

export interface SyncDealsResult {
  scrapeRunId: string;
  pagesFetched: number;
  itemsProcessed: number;
  itemsFailed: number;
  checkedListingIds: string[];
}

export async function runCheapSharkDealSync(
  query: DealSyncQuery,
  dependencies: {
    database: Database;
    adapter: CheapSharkAdapter;
    logger: Logger;
    source: 'SCHEDULED' | 'MANUAL';
    maxPages?: number;
  },
): Promise<SyncDealsResult> {
  const { database, adapter, logger, source, maxPages = 1 } = dependencies;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) {
    throw new Error('maxPages must be an integer between 1 and 10');
  }

  const scrapeRun = await database.scrapeRun.create({
    data: { provider: 'cheapshark', source, status: 'RUNNING' },
  });
  let pagesFetched = 0;
  let itemsProcessed = 0;
  let itemsFailed = 0;
  const checkedListingIds = new Set<string>();

  try {
    const storeBatch = await adapter.fetchStores();
    itemsFailed += storeBatch.invalidItems;
    if (storeBatch.invalidItems > 0) {
      logger.warn({ invalidItems: storeBatch.invalidItems }, 'CheapShark stores failed validation');
    }

    for (const store of storeBatch.items) {
      try {
        const byProviderId = await database.store.findUnique({
          where: { cheapsharkStoreId: store.cheapsharkStoreId },
        });
        if (byProviderId) {
          await database.store.update({
            where: { id: byProviderId.id },
            data: {
              name: store.name,
              slug: store.slug,
              logoUrl: store.logoUrl,
              isActive: store.isActive,
            },
          });
          continue;
        }

        const bySlug = await database.store.findUnique({ where: { slug: store.slug } });
        if (bySlug?.cheapsharkStoreId === null) {
          await database.store.update({
            where: { id: bySlug.id },
            data: { ...store },
          });
          continue;
        }

        await database.store.create({
          data: {
            ...store,
            slug: bySlug ? `cheapshark-${store.cheapsharkStoreId}-${store.slug}` : store.slug,
          },
        });
      } catch (error) {
        itemsFailed += 1;
        logger.warn({ err: error, storeId: store.cheapsharkStoreId }, 'Failed to sync store');
      }
    }

    for (let pageOffset = 0; pageOffset < maxPages; pageOffset += 1) {
      const batch = await adapter.fetchDeals({
        ...query,
        pageNumber: query.pageNumber + pageOffset,
      });
      pagesFetched += 1;
      itemsFailed += batch.invalidItems;
      if (batch.invalidItems > 0) {
        logger.warn(
          { pageNumber: query.pageNumber + pageOffset, invalidItems: batch.invalidItems },
          'CheapShark deals failed validation',
        );
      }

      for (const rawDeal of batch.items) {
        try {
          const deal = normalizeCheapSharkDeal(rawDeal);
          checkedListingIds.add(await persistDeal(database, deal));
          itemsProcessed += 1;
        } catch (error) {
          itemsFailed += 1;
          logger.warn({ err: error, dealId: rawDeal.dealID }, 'Failed to ingest deal');
        }
      }

      if (batch.items.length + batch.invalidItems < query.pageSize) break;
    }

    const status = itemsFailed === 0 ? 'SUCCEEDED' : itemsProcessed === 0 ? 'FAILED' : 'PARTIAL';
    await database.scrapeRun.update({
      where: { id: scrapeRun.id },
      data: {
        finishedAt: new Date(),
        status,
        itemsProcessed,
        itemsFailed,
        errorMessage:
          itemsFailed > 0 ? `${itemsFailed} item(s) failed validation or ingestion` : null,
      },
    });
    logger.info(
      { scrapeRunId: scrapeRun.id, pagesFetched, itemsProcessed, itemsFailed, status },
      'CheapShark deal sync finished',
    );
    return {
      scrapeRunId: scrapeRun.id,
      pagesFetched,
      itemsProcessed,
      itemsFailed,
      checkedListingIds: [...checkedListingIds],
    };
  } catch (error) {
    itemsFailed += 1;
    logger.error(
      { err: error, scrapeRunId: scrapeRun.id, pagesFetched, itemsProcessed, itemsFailed },
      'CheapShark deal sync failed',
    );
    await database.scrapeRun.update({
      where: { id: scrapeRun.id },
      data: {
        finishedAt: new Date(),
        status: 'FAILED',
        itemsProcessed,
        itemsFailed,
        errorMessage: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown sync error',
      },
    });
    throw error;
  }
}
