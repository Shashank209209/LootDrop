import { z } from 'zod';

const providerId = z.union([z.string(), z.number()]).transform(String);
const optionalProviderId = providerId.nullable().optional();
const optionalNumber = z
  .union([z.string(), z.number()])
  .transform((value) => Number(value))
  .refine(Number.isFinite)
  .nullable()
  .optional();

export const cheapSharkDealSchema = z
  .object({
    dealID: z.string().min(1),
    storeID: providerId,
    gameID: providerId,
    title: z.string().trim().min(1).max(300),
    salePrice: z.union([z.string(), z.number()]),
    normalPrice: z.union([z.string(), z.number()]).nullable().optional(),
    savings: optionalNumber,
    isOnSale: z.union([z.string(), z.number(), z.boolean()]).optional(),
    steamAppID: optionalProviderId,
    releaseDate: optionalNumber,
    metacriticScore: optionalNumber,
    thumb: z
      .union([z.string().url(), z.literal('')])
      .nullable()
      .optional(),
  })
  .passthrough();

export const cheapSharkStoreSchema = z
  .object({
    storeID: providerId,
    storeName: z.string().trim().min(1).max(150),
    isActive: z.union([z.number(), z.boolean()]),
    images: z
      .object({
        logo: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const cheapSharkDealsResponseSchema = z.array(z.unknown());
export const cheapSharkStoresResponseSchema = z.array(z.unknown());

export type CheapSharkDeal = z.infer<typeof cheapSharkDealSchema>;
export type CheapSharkStore = z.infer<typeof cheapSharkStoreSchema>;
