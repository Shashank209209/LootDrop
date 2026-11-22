import { Worker, type DefaultJobOptions, type Processor, type WorkerOptions } from 'bullmq';

const idleWaitSeconds = 90;
const stalledCheckMilliseconds = 60_000;

export const jobRetryOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
} satisfies DefaultJobOptions;

class JobWorker<Data, Result> extends Worker<Data, Result> {
  protected override getBlockTimeout(blockUntil: number): number {
    const secondsUntilDue = (blockUntil - Date.now()) / 1000;
    if (secondsUntilDue <= 0) return super.getBlockTimeout(blockUntil);

    // The default 10-second cap polls continually with a distant scheduled job.
    // Keep BullMQ's marker wake-up and watchdog, and never wait past the next due job.
    return Math.min(idleWaitSeconds, Math.max(this.minimumBlockTimeout, secondsUntilDue));
  }
}

export function createJobWorker<Data = unknown, Result = unknown>(
  queue: string,
  processor: Processor<Data, Result>,
  options: Pick<WorkerOptions, 'connection' | 'prefix'>,
) {
  return new JobWorker(queue, processor, {
    ...options,
    concurrency: 1,
    drainDelay: idleWaitSeconds,
    stalledInterval: stalledCheckMilliseconds,
  });
}
