import { z } from 'zod';

const optionalInteger = (defaultValue: number, min: number, max: number) =>
  z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
    return Number(value);
  }, z.number().int().min(min).max(max));

export const wishlistQuerySchema = z
  .object({
    page: optionalInteger(1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: optionalInteger(20, 1, 50),
  })
  .strict();

export const wishlistAddRequestSchema = z
  .object({
    gameId: z.string().uuid(),
  })
  .strict();

export const wishlistBestListingSchema = z.object({
  store: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
  currentPrice: z.number().finite(),
  regularPrice: z.number().finite().nullable(),
  discountPercent: z.number().int().nullable(),
  currency: z.string().length(3),
  isOnSale: z.boolean(),
  dealUrl: z.string().url(),
});

export const wishlistEntrySchema = z.object({
  gameId: z.string().uuid(),
  gameSlug: z.string(),
  gameTitle: z.string(),
  addedAt: z.string().datetime(),
  bestListing: wishlistBestListingSchema.nullable(),
});

export const wishlistResponseSchema = z.object({
  data: z.array(wishlistEntrySchema),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
  }),
});

export const wishlistIdsResponseSchema = z.object({
  gameIds: z.array(z.string().uuid()).max(1000),
});

export type WishlistQuery = z.infer<typeof wishlistQuerySchema>;
export type WishlistAddRequest = z.infer<typeof wishlistAddRequestSchema>;
export type WishlistBestListing = z.infer<typeof wishlistBestListingSchema>;
export type WishlistEntry = z.infer<typeof wishlistEntrySchema>;
export type WishlistResponse = z.infer<typeof wishlistResponseSchema>;
export type WishlistIdsResponse = z.infer<typeof wishlistIdsResponseSchema>;
