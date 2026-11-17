import { z } from 'zod';

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().finite().nullable().optional();

export const rawgSearchRecordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
});

export const rawgSearchResponseSchema = z.object({
  results: z.array(z.unknown()),
});

export const rawgGenreSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
});

export const rawgPlatformSchema = z.object({
  platform: z.object({
    id: z.number().int().positive(),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1),
  }),
});

export const rawgGameDetailSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  background_image: nullableString,
  description_raw: nullableString,
  released: nullableString,
  metacritic: nullableNumber,
  rating: nullableNumber,
  genres: z.array(rawgGenreSchema).default([]),
  platforms: z.array(rawgPlatformSchema).nullable().default([]),
});

export type RawgSearchRecord = z.infer<typeof rawgSearchRecordSchema>;
export type RawgGameDetail = z.infer<typeof rawgGameDetailSchema>;
