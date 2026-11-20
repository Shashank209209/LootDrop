import { Worker } from 'bullmq';
import pino from 'pino';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { queuePrefix, redis } from '../db/redis.js';
import { CheapSharkAdapter } from '../pricing/cheapshark/adapter.js';
import { dealSyncQuerySchema } from '../pricing/contracts.js';
import { RedisJsonCache } from '../pricing/cache.js';
import { CheapSharkRateLimiter } from '../pricing/rate-limiter.js';
import { runCheapSharkDealSync } from '../pricing/ingest-deals.js';
import { syncDealsQueue } from './sync-deals-queue.js';
import {
  alertEmailJobSchema,
  alertEmailQueue,
  alertEvaluationQueue,
  enqueueAlertEmail,
  enqueueAlertEvaluation,
  evaluateAlertsJobSchema,
} from '../alerts/alert-queues.js';
import { runAlertEvaluation } from '../alerts/evaluation-runner.js';
import { runSyncAndEnqueueAlerts } from '../alerts/sync-handler.js';
import { createMailer } from '../alerts/mailer.js';
import { runAlertEmail } from '../alerts/email-runner.js';
import { enrichmentDisabledMessage, runEnrichment } from '../pricing/rawg/run-enrichment.js';

const logger = pino({ level: env.LOG_LEVEL });
const mailer = createMailer({
  provider: env.EMAIL_PROVIDER,
  logger,
  ...(env.RESEND_API_KEY ? { resendApiKey: env.RESEND_API_KEY } : {}),
  ...(env.EMAIL_FROM ? { emailFrom: env.EMAIL_FROM } : {}),
});
const adapter = new CheapSharkAdapter({
  cache: new RedisJsonCache(redis),
  limiter: new CheapSharkRateLimiter(redis),
  userAgent: env.CHEAPSHARK_USER_AGENT,
});

const schedulerId = 'cheapshark-deals-sync';
const intervalMilliseconds = env.DEAL_SYNC_INTERVAL_MINUTES * 60 * 1000;
const schedulesEnabled = process.env.DISABLE_REPEATABLE_SCHEDULES !== '1';
if (schedulesEnabled) {
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
}
const scheduledJob = schedulesEnabled ? await syncDealsQueue.getJobScheduler(schedulerId) : null;
const workerOptions = { connection: redis, prefix: queuePrefix, concurrency: 1, drainDelay: 30 };

const enrichmentJobName = 'enrich-metadata';
if (!env.RAWG_API_KEY) {
  logger.warn(enrichmentDisabledMessage);
  if (schedulesEnabled) await syncDealsQueue.removeJobScheduler(enrichmentJobName);
} else if (schedulesEnabled) {
  const every = env.ENRICH_INTERVAL_MINUTES * 60 * 1000;
  const existing = await syncDealsQueue.getJobScheduler(enrichmentJobName);
  if (existing?.every !== every) {
    await syncDealsQueue.upsertJobScheduler(
      enrichmentJobName,
      { every, startDate: new Date(Date.now() + every) },
      {
        name: enrichmentJobName,
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      },
    );
  }
}

async function runEnrichmentJob() {
  if (!env.RAWG_API_KEY) return { stopped: 'disabled' };
  try {
    const result = await runEnrichment(prisma, redis, logger);
    const counts = {
      examined: result.examined,
      matched: result.matched,
      noMatch: result.noMatch,
      ambiguous: result.ambiguous,
      conflicts: result.conflicts,
      failed: result.failed,
      requestsUsed: result.requestsUsed,
      negativeCacheHits: result.negativeCacheHits,
      stopped: result.stopped,
    };
    logger.info(counts, 'Metadata enrichment job completed');
    return counts;
  } catch {
    throw new Error('Metadata enrichment run failed');
  }
}

const worker = new Worker(
  'sync-deals',
  async (job) => {
    if (job.name === enrichmentJobName) return runEnrichmentJob();
    const query = dealSyncQuerySchema.parse(job.data);
    return runSyncAndEnqueueAlerts(query, {
      runSync: (syncQuery) =>
        runCheapSharkDealSync(syncQuery, {
          database: prisma,
          adapter,
          logger,
          source: job.name === 'scheduled-deal-sync' ? 'SCHEDULED' : 'MANUAL',
          maxPages: env.CHEAPSHARK_MAX_PAGES,
        }),
      enqueueEvaluation: ({ scrapeRunId, checkedListingIds }) =>
        enqueueAlertEvaluation({ scrapeRunId, listingIds: checkedListingIds }),
    });
  },
  workerOptions,
);

const alertWorker = new Worker(
  'evaluate-alerts',
  async (job) => {
    const data = evaluateAlertsJobSchema.parse(job.data);
    return runAlertEvaluation(data, {
      database: prisma,
      queueEmail: enqueueAlertEmail,
      logger,
    });
  },
  workerOptions,
);

const emailWorker = new Worker(
  'alert-emails',
  async (job) => {
    const data = alertEmailJobSchema.parse(job.data);
    await runAlertEmail(data.notificationId, {
      database: prisma,
      mailer,
      logger,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
  },
  workerOptions,
);

worker.on('completed', (job, result) => {
  if (job.name !== enrichmentJobName)
    logger.info({ jobId: job.id, result }, 'Deal sync job completed');
});
worker.on('failed', (job, error) => {
  if (job?.name === enrichmentJobName) {
    logger.error({ jobId: job.id }, 'Metadata enrichment job failed');
  } else {
    logger.error({ jobId: job?.id, err: error }, 'Deal sync job failed');
  }
});
worker.on('error', (error) => {
  logger.error({ err: error }, 'Deal sync worker error');
});

alertWorker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'Alert evaluation job completed');
});
alertWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'Alert evaluation job failed');
});
alertWorker.on('error', (error) => {
  logger.error({ err: error }, 'Alert evaluation worker error');
});

emailWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Alert email job completed');
});
emailWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, errorName: error.name }, 'Alert email job failed');
});
emailWorker.on('error', (error) => {
  logger.error({ errorName: error.name }, 'Alert email worker error');
});

async function shutdown() {
  await emailWorker.close();
  await alertWorker.close();
  await worker.close();
  await syncDealsQueue.close();
  await alertEvaluationQueue.close();
  await alertEmailQueue.close();
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
  schedulesEnabled
    ? 'Deal sync worker ready with a bounded recurring schedule'
    : 'Deal sync worker ready without recurring schedules',
);
