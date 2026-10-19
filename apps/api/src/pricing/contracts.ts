import { z } from 'zod';

export const dealSyncQuerySchema = z
  .object({
    pageNumber: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(20).default(20),
    storeID: z.string().min(1).max(50).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    steamAppID: z.number().int().positive().optional(),
    onSale: z.boolean().optional(),
    upperPrice: z.number().finite().positive().optional(),
    sortBy: z
      .enum(['DealRating', 'Title', 'Savings', 'Price', 'Metacritic', 'Reviews', 'Release'])
      .default('DealRating'),
  })
  .strict();

export type DealSyncQuery = z.infer<typeof dealSyncQuerySchema>;

export interface SourceBatch<T> {
  items: T[];
  invalidItems: number;
}

export interface PriceSourceAdapter<TQuery, TDeal> {
  fetchDeals(query: TQuery): Promise<SourceBatch<TDeal>>;
}

export interface NormalizedDeal {
  sourceDealId: string;
  sourceGameId: string;
  sourceStoreId: string;
  title: string;
  normalizedTitle: string;
  steamAppId: number | null;
  salePrice: number;
  regularPrice: number | null;
  discountPercent: number | null;
  isOnSale: boolean;
  currency: 'USD';
  url: string;
  coverUrl: string | null;
  releaseDate: Date | null;
  metacriticScore: number | null;
}

export interface NormalizedStore {
  cheapsharkStoreId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
}
