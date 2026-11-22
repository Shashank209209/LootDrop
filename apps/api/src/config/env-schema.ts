import { z } from 'zod';

export const dealSyncIntervalSchema = z.coerce.number().int().min(30).max(60).default(45);
const rawgApiKeySchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const originSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}, 'Provide a browser origin');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: originSchema.optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    REDIS_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('lootdrop-api'),
    AUTH_COOKIE_SECURE: z.preprocess((value) => {
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
      return value;
    }, z.boolean().optional()),
    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(10),
    CHEAPSHARK_USER_AGENT: z.string().min(8).default('LootDrop/0.1.0'),
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
  .transform((config) => ({
    ...config,
    WEB_ORIGIN:
      config.WEB_ORIGIN ?? (config.NODE_ENV === 'production' ? '' : 'http://localhost:5173'),
    AUTH_COOKIE_SECURE: config.AUTH_COOKIE_SECURE ?? config.NODE_ENV === 'production',
  }))
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production') {
      const require = (condition: boolean, name: string) => {
        if (!condition)
          context.addIssue({ code: 'custom', path: [name], message: 'Invalid production setting' });
      };
      require(config.WEB_ORIGIN.startsWith('https://'), 'WEB_ORIGIN');
      require(Boolean(config.DIRECT_URL), 'DIRECT_URL');
      require(config.AUTH_COOKIE_SECURE, 'AUTH_COOKIE_SECURE');
      require(new Set(config.JWT_ACCESS_SECRET).size >= 12 &&
        !/^(change|replace|example)/i.test(config.JWT_ACCESS_SECRET), 'JWT_ACCESS_SECRET');
    }
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
