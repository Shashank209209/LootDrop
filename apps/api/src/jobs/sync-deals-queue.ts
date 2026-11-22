import { Queue } from 'bullmq';
import { queuePrefix, redis } from '../db/redis.js';
import { dealSyncQuerySchema } from '../pricing/contracts.js';
import { jobRetryOptions } from './job-worker.js';

export const syncDealsQueue = new Queue('sync-deals', {
  connection: redis,
  prefix: queuePrefix,
  defaultJobOptions: {
    ...jobRetryOptions,
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});

export async function enqueueDealsSync(input: unknown) {
  const query = dealSyncQuerySchema.parse(input);
  return syncDealsQueue.add('user-deal-query', query);
}
