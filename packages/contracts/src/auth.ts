import { z } from 'zod';

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
});

export const registerRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(1).max(50),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();

export const authSessionResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
});

export const refreshResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
});

export const meResponseSchema = z.object({
  user: authUserSchema,
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
