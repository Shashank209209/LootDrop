import { Queue } from 'bullmq';
import { redis } from '../db/redis.js';
import { dealSyncQuerySchema } from '../pricing/contracts.js';

export const syncDealsQueue = new Queue('sync-deals', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});

export async function enqueueDealsSync(input: unknown) {
  const query = dealSyncQuerySchema.parse(input);
  return syncDealsQueue.add('user-deal-query', query);
}
