import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { env } from '../../config/env.js';
import { RedisJsonCache } from '../cache.js';
import { RawgAdapter } from './adapter.js';
import { enrichMetadata } from './enrichment.js';
import { RedisNegativeCache } from './negative-cache.js';
import { RawgRateLimiter } from './rate-limiter.js';

export const enrichmentDisabledMessage = 'RAWG_API_KEY is missing; metadata enrichment is disabled';

export function runEnrichment(
  database: PrismaClient,
  redis: Redis,
  logger: Logger,
  limit?: number,
) {
  const apiKey = env.RAWG_API_KEY;
  const databaseUrl = new URL(env.DATABASE_URL);
  const identity = databaseUrl.hostname.replace('-pooler.', '.') + databaseUrl.pathname;
  const prefix = 'enrichment:' + createHash('sha256').update(identity).digest('hex').slice(0, 20);
  return enrichMetadata({
    database,
    negativeCache: new RedisNegativeCache(redis, prefix),
    logger,
    batchSize: Math.min(limit ?? env.RAWG_ENRICH_BATCH_SIZE, env.RAWG_ENRICH_BATCH_SIZE),
    ...(apiKey
      ? {
          adapter: new RawgAdapter({
            apiKey,
            cache: new RedisJsonCache(redis, prefix + ':'),
            limiter: new RawgRateLimiter(redis),
            maxRequests: env.RAWG_MAX_REQUESTS_PER_RUN,
          }),
        }
      : {}),
  });
}
