import { z } from 'zod';

export const dealSyncIntervalSchema = z.coerce.number().int().min(30).max(60).default(45);
const rawgApiKeySchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const cookieSecureDefault = process.env.NODE_ENV === 'production';

export const envSchema = z
  .object({
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('lootdrop-api'),
    AUTH_COOKIE_SECURE: z
      .preprocess((value) => {
        if (value === undefined) return cookieSecureDefault;
        if (value === 'true' || value === '1') return true;
        if (value === 'false' || value === '0') return false;
        return value;
      }, z.boolean())
      .default(cookieSecureDefault),
    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(10),
    CHEAPSHARK_USER_AGENT: z.string().min(8).default('DealHunter/0.1.0'),
    CHEAPSHARK_MAX_PAGES: z.coerce.number().int().min(1).max(10).default(2),
    DEAL_SYNC_INTERVAL_MINUTES: dealSyncIntervalSchema,
    RAWG_API_KEY: rawgApiKeySchema,
    RAWG_MAX_REQUESTS_PER_RUN: z.coerce.number().int().min(1).max(100).default(30),
    RAWG_ENRICH_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(15),
    ENRICH_INTERVAL_MINUTES: z.coerce.number().int().min(30).max(240).default(60),
    EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
  })
  .superRefine((config, context) => {
    if (config.AUTH_COOKIE_SAME_SITE === 'none' && !config.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_COOKIE_SECURE'],
        message: 'AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none',
      });
    }
    if (config.EMAIL_PROVIDER === 'resend') {
      if (!config.RESEND_API_KEY) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY is required when EMAIL_PROVIDER is resend',
        });
      }
      if (!config.EMAIL_FROM) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'EMAIL_FROM is required when EMAIL_PROVIDER is resend',
        });
      }
    }
  });
