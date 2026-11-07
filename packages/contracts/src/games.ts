import { z } from 'zod';

export const gameSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100),
  })
  .strict();

export const gameSearchItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  bestPrice: z.number().nullable(),
  currency: z.string().nullable(),
  bestDiscountPercent: z.number().nullable(),
});

export const gameSearchResponseSchema = z.object({
  data: z.array(gameSearchItemSchema),
});

export const gameSlugSchema = z.string().min(1).max(320);

export const gameListingSchema = z.object({
  id: z.string(),
  store: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  currentPrice: z.number(),
  regularPrice: z.number().nullable(),
  discountPercent: z.number().nullable(),
  currency: z.string(),
  isOnSale: z.boolean(),
  dealUrl: z.string().url(),
  lastCheckedAt: z.string().datetime(),
});

export const gameDetailResponseSchema = z.object({
  data: z.object({
    game: z.object({ id: z.string(), slug: z.string(), title: z.string() }),
    listings: z.array(gameListingSchema),
    summary: z.object({
      bestListingId: z.string().nullable(),
      lowestRecordedPrice: z.number().nullable(),
      highestRecordedPrice: z.number().nullable(),
      snapshotCount: z.number().int().nonnegative(),
    }),
  }),
});

export const priceHistoryRangeSchema = z.enum(['30d', '90d', '1y', 'all']);

export const priceHistoryQuerySchema = z
  .object({
    range: priceHistoryRangeSchema.default('90d'),
    store: z
      .string()
      .trim()
      .min(1)
      .max(170)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
  })
  .strict();

export const priceHistoryPointSchema = z.object({
  capturedAt: z.string().datetime(),
  price: z.number(),
  regularPrice: z.number().nullable(),
  discountPercent: z.number().nullable(),
});

export const priceHistoryResponseSchema = z.object({
  data: z.array(
    z.object({
      listingId: z.string(),
      store: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
      currency: z.string(),
      points: z.array(priceHistoryPointSchema).max(366),
    }),
  ),
  range: z.object({
    from: z.string().datetime().nullable(),
    to: z.string().datetime(),
  }),
});

export type GameSearchQuery = z.infer<typeof gameSearchQuerySchema>;
export type GameSearchItem = z.infer<typeof gameSearchItemSchema>;
export type GameSearchResponse = z.infer<typeof gameSearchResponseSchema>;
export type GameListingResponse = z.infer<typeof gameListingSchema>;
export type GameDetailResponse = z.infer<typeof gameDetailResponseSchema>;
export type PriceHistoryQuery = z.infer<typeof priceHistoryQuerySchema>;
export type PriceHistoryPoint = z.infer<typeof priceHistoryPointSchema>;
export type PriceHistoryResponse = z.infer<typeof priceHistoryResponseSchema>;
