import { Worker } from 'bullmq';
import pino from 'pino';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { redis } from '../db/redis.js';
import { CheapSharkAdapter } from '../pricing/cheapshark/adapter.js';
import { dealSyncQuerySchema } from '../pricing/contracts.js';
import { RedisJsonCache } from '../pricing/cache.js';
import { CheapSharkRateLimiter } from '../pricing/rate-limiter.js';
import { runCheapSharkDealSync } from '../pricing/ingest-deals.js';

const logger = pino({ level: env.LOG_LEVEL });
const adapter = new CheapSharkAdapter({
  cache: new RedisJsonCache(redis),
  limiter: new CheapSharkRateLimiter(redis),
  userAgent: env.CHEAPSHARK_USER_AGENT,
});

const worker = new Worker(
  'sync-deals',
  async (job) => {
    const query = dealSyncQuerySchema.parse(job.data);
    return runCheapSharkDealSync(query, { database: prisma, adapter, logger });
  },
  { connection: redis, concurrency: 1 },
);

worker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'Deal sync job completed');
});
worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'Deal sync job failed');
});
worker.on('error', (error) => {
  logger.error({ err: error }, 'Deal sync worker error');
});

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

logger.info('Deal sync worker ready; jobs are enqueued on user queries only');
