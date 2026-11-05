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
import { syncDealsQueue } from './sync-deals-queue.js';

const logger = pino({ level: env.LOG_LEVEL });
const adapter = new CheapSharkAdapter({
  cache: new RedisJsonCache(redis),
  limiter: new CheapSharkRateLimiter(redis),
  userAgent: env.CHEAPSHARK_USER_AGENT,
});

const schedulerId = 'cheapshark-deals-sync';
const intervalMilliseconds = env.DEAL_SYNC_INTERVAL_MINUTES * 60 * 1000;
const existingScheduler = await syncDealsQueue.getJobScheduler(schedulerId);
if (!existingScheduler || existingScheduler.every !== intervalMilliseconds) {
  await syncDealsQueue.upsertJobScheduler(
    schedulerId,
    {
      every: intervalMilliseconds,
      startDate: new Date(Date.now() + intervalMilliseconds),
    },
    {
      name: 'scheduled-deal-sync',
      data: dealSyncQuerySchema.parse({ pageNumber: 0, pageSize: 20, sortBy: 'DealRating' }),
    },
  );
}
const scheduledJob = await syncDealsQueue.getJobScheduler(schedulerId);

const worker = new Worker(
  'sync-deals',
  async (job) => {
    const query = dealSyncQuerySchema.parse(job.data);
    return runCheapSharkDealSync(query, {
      database: prisma,
      adapter,
      logger,
      source: job.name === 'scheduled-deal-sync' ? 'SCHEDULED' : 'MANUAL',
      maxPages: env.CHEAPSHARK_MAX_PAGES,
    });
  },
  { connection: redis, concurrency: 1, drainDelay: 30 },
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
  await syncDealsQueue.close();
  await prisma.$disconnect();
  await redis.quit();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

logger.info(
  {
    schedulerId: scheduledJob?.key ?? schedulerId,
    intervalMinutes: env.DEAL_SYNC_INTERVAL_MINUTES,
    maxPagesPerRun: env.CHEAPSHARK_MAX_PAGES,
    maxDealsPerRun: env.CHEAPSHARK_MAX_PAGES * 20,
    nextScheduledRun: scheduledJob?.next ? new Date(scheduledJob.next).toISOString() : null,
  },
  'Deal sync worker ready with a bounded recurring schedule',
);
