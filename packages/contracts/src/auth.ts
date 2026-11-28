import { z } from 'zod';
import { displayCurrencySchema } from './currency.js';

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  emailVerified: z.boolean().optional(),
});

const accountEmailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerRequestSchema = z
  .object({
    email: accountEmailSchema,
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(1).max(50),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: accountEmailSchema,
    password: z.string().min(12).max(128),
  })
  .strict();

export const forgotPasswordRequestSchema = z.object({ email: accountEmailSchema }).strict();

export const accountLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const verifyEmailRequestSchema = z.object({ token: accountLinkTokenSchema }).strict();

export const resetPasswordRequestSchema = verifyEmailRequestSchema.extend({
  password: z
    .string()
    .min(12)
    .max(72)
    .refine((password) => new TextEncoder().encode(password).length <= 72, {
      message: 'Password cannot exceed 72 bytes.',
    }),
});

export const authSessionResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
});

export const refreshResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().min(1),
});

export const meResponseSchema = z.object({
  user: authUserSchema.extend({ preferredCurrency: displayCurrencySchema }),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
