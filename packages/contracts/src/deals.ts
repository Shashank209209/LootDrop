import { z } from 'zod';
import { gameMetadataSchema, type GameMetadata } from './game-metadata.js';

export const dealSortOptions = [
  'discount_desc',
  'price_asc',
  'price_desc',
  'newest',
  'title_asc',
  'rating_desc',
] as const;

const optionalNonNegativeNumber = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
  return Number(value);
}, z.number().finite().nonnegative().optional());

const optionalInteger = (defaultValue: number, min: number, max: number) =>
  z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
    return Number(value);
  }, z.number().int().min(min).max(max));

const splitValues = (value: unknown) =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [entry]))
    .map((entry) => (typeof entry === 'string' ? entry.trim() : entry));

const storesSchema = z.preprocess(splitValues, z.array(z.string().min(1).max(170)).default([]));

const taxonomySlugs = (limit: number) =>
  z.preprocess(
    (value, context) => {
      const values = splitValues(value);
      if (values.length > limit) {
        context.addIssue({
          code: z.ZodIssueCode.too_big,
          type: 'array',
          maximum: limit,
          inclusive: true,
          message: `Use at most ${limit} slugs`,
        });
        return z.NEVER;
      }
      return values;
    },
    z
      .array(
        z
          .string()
          .max(120)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      )
      .max(limit)
      .default([])
      .transform((values) => [...new Set(values)]),
  );

export const dealsQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    store: storesSchema,
    genre: taxonomySlugs(10),
    platform: taxonomySlugs(6),
    onSale: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    minPrice: optionalNonNegativeNumber,
    maxPrice: optionalNonNegativeNumber,
    minDiscount: z.preprocess((value) => {
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
      return Number(value);
    }, z.number().finite().min(0).max(100).optional()),
    sort: z.enum(dealSortOptions).default('discount_desc'),
    page: optionalInteger(1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: optionalInteger(20, 1, 50),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minPrice'],
        message: 'minPrice must be less than or equal to maxPrice',
      });
    }
  });

export type DealsQuery = z.infer<typeof dealsQuerySchema>;

export interface DealResponse extends GameMetadata {
  id: string;
  gameId: string;
  gameTitle: string;
  gameSlug: string;
  store: { id: string; name: string; slug: string };
  currentPrice: number;
  regularPrice: number | null;
  discountPercent: number | null;
  currency: string;
  isOnSale: boolean;
  dealUrl: string;
  lastCheckedAt: string;
}

export const dealResponseSchema = gameMetadataSchema.extend({
  id: z.string(),
  gameId: z.string(),
  gameTitle: z.string(),
  gameSlug: z.string(),
  store: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  currentPrice: z.number(),
  regularPrice: z.number().nullable(),
  discountPercent: z.number().nullable(),
  currency: z.string(),
  isOnSale: z.boolean(),
  dealUrl: z.string().url(),
  lastCheckedAt: z.string().datetime(),
});

export const dealsResponseSchema = z.object({
  data: z.array(dealResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
  }),
});

export const storeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const storesResponseSchema = z.object({
  data: z.array(storeResponseSchema),
});

export interface DealsResponse {
  data: DealResponse[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export interface StoreResponse {
  id: string;
  name: string;
  slug: string;
}
