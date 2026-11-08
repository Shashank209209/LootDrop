import { z } from 'zod';

export const dealSyncIntervalSchema = z.coerce.number().int().min(30).max(60).default(45);

const cookieSecureDefault = process.env.NODE_ENV === 'production';

export const envSchema = z
  .object({
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
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
  })
  .superRefine((config, context) => {
    if (config.AUTH_COOKIE_SAME_SITE === 'none' && !config.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_COOKIE_SECURE'],
        message: 'AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none',
      });
    }
  });
