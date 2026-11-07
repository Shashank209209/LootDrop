import { z } from 'zod';

export const dealSortOptions = [
  'discount_desc',
  'price_asc',
  'price_desc',
  'newest',
  'title_asc',
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

const storesSchema = z.preprocess(
  (value) =>
    (Array.isArray(value) ? value : value === undefined ? [] : [value])
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [entry]))
      .map((entry) => (typeof entry === 'string' ? entry.trim() : entry)),
  z.array(z.string().min(1).max(170)).default([]),
);

export const dealsQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    store: storesSchema,
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

export interface DealResponse {
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
