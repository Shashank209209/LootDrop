import { z } from 'zod';
import { dealResponseSchema } from './deals.js';

const limitSchema = (defaultValue: number, max: number) =>
  z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
    return Number(value);
  }, z.number().int().min(1).max(max));

export const bestDealsQuerySchema = z.object({ limit: limitSchema(10, 24) }).strict();
export const freeDealsQuerySchema = z.object({ limit: limitSchema(20, 50) }).strict();
export const historicalLowsQuerySchema = z.object({ limit: limitSchema(10, 24) }).strict();

export const historicalLowDealSchema = dealResponseSchema.extend({
  lowestRecordedPrice: z.number(),
});

export const curatedDealsResponseSchema = z.object({
  data: z.array(dealResponseSchema),
});

export const historicalLowsResponseSchema = z.object({
  data: z.array(historicalLowDealSchema),
});

export type BestDealsQuery = z.infer<typeof bestDealsQuerySchema>;
export type FreeDealsQuery = z.infer<typeof freeDealsQuerySchema>;
export type HistoricalLowsQuery = z.infer<typeof historicalLowsQuerySchema>;
export type CuratedDealsResponse = z.infer<typeof curatedDealsResponseSchema>;
export type HistoricalLowDeal = z.infer<typeof historicalLowDealSchema>;
export type HistoricalLowsResponse = z.infer<typeof historicalLowsResponseSchema>;
