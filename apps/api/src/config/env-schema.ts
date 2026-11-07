import { z } from 'zod';

export const dealSyncIntervalSchema = z.coerce.number().int().min(30).max(60).default(45);

export const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CHEAPSHARK_USER_AGENT: z.string().min(8).default('DealHunter/0.1.0'),
  CHEAPSHARK_MAX_PAGES: z.coerce.number().int().min(1).max(10).default(2),
  DEAL_SYNC_INTERVAL_MINUTES: dealSyncIntervalSchema,
});
