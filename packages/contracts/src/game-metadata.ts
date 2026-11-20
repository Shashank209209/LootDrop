import { z } from 'zod';

export const taxonomyItemSchema = z.object({ slug: z.string(), name: z.string() });
export const taxonomyResponseSchema = z.object({
  data: z.array(taxonomyItemSchema.extend({ dealCount: z.number().int().positive() })),
});

export const gameMetadataSchema = z.object({
  coverUrl: z.string().nullable(),
  genres: z.array(taxonomyItemSchema),
  platforms: z.array(taxonomyItemSchema),
  releaseDate: z.string().date().nullable(),
  metacriticScore: z.number().nullable(),
  userRating: z.number().nullable(),
});

export type GameMetadata = z.infer<typeof gameMetadataSchema>;
export type TaxonomyResponse = z.infer<typeof taxonomyResponseSchema>;
