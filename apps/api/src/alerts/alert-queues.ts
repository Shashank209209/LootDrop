import { Queue } from 'bullmq';
import { z } from 'zod';
import { redis } from '../db/redis.js';

export const evaluateAlertsJobSchema = z
  .object({
    scrapeRunId: z.string().uuid(),
    listingIds: z.array(z.string().uuid()).min(1),
  })
  .strict();

export type EvaluateAlertsJob = z.infer<typeof evaluateAlertsJobSchema>;
export const alertEmailJobSchema = z.object({ notificationId: z.string().uuid() }).strict();

export const alertEvaluationQueue = new Queue<EvaluateAlertsJob>('evaluate-alerts', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});

export const alertEmailQueue = new Queue<{ notificationId: string }>('alert-emails', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});

export async function enqueueAlertEvaluation(input: EvaluateAlertsJob): Promise<void> {
  const job = evaluateAlertsJobSchema.parse(input);
  await alertEvaluationQueue.add('evaluate-checked-listings', job, {
    jobId: `evaluate-${job.scrapeRunId}`,
  });
}

export async function enqueueAlertEmail(notificationId: string): Promise<void> {
  const job = alertEmailJobSchema.parse({ notificationId });
  await alertEmailQueue.add('send-alert-email', job, {
    jobId: `alert-email-${job.notificationId}`,
  });
}
