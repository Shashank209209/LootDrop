import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Prisma } from '@prisma/client';
import { Queue, QueueEvents, type Processor, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAlertEvaluation } from '../alerts/evaluation-runner.js';
import { createJobWorker, jobRetryOptions } from './job-worker.js';

const portSetting = process.env.LOOTDROP_QUEUE_TEST_PORT;

describe.skipIf(!portSetting)('BullMQ on isolated loopback Redis', () => {
  let connection: Redis;
  let queue: Queue;
  let events: QueueEvents;
  let worker: Pick<Worker, 'close'> | undefined;
  let prefix: string;

  beforeAll(async () => {
    const port = Number(portSetting);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
      throw new Error('LOOTDROP_QUEUE_TEST_PORT must select a local test Redis port');
    }
    connection = new Redis({
      host: '127.0.0.1',
      port,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    await connection.ping();
  });

  beforeEach(async () => {
    prefix = 'phase6-job-test-' + randomUUID();
    queue = new Queue('jobs', { connection, prefix, defaultJobOptions: jobRetryOptions });
    events = new QueueEvents('jobs', { connection, prefix });
    await events.waitUntilReady();
  });

  afterEach(async () => {
    await worker?.close(true);
    worker = undefined;
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  afterAll(() => connection?.disconnect());

  function start<Data, Result>(processor: Processor<Data, Result>) {
    const running = createJobWorker('jobs', processor, { connection, prefix });
    worker = running;
    return running;
  }

  it('wakes for immediate jobs and runs repeatable jobs while a distant schedule exists', async () => {
    const interval = 45 * 60_000;
    await queue.upsertJobScheduler(
      'cheapshark-deals-sync',
      { every: interval, startDate: new Date(Date.now() + interval) },
      { name: 'scheduled-deal-sync' },
    );
    const running = start(async () => 'processed');
    await once(running, 'drained');
    const immediate = await queue.add('user-deal-query', {});
    expect(await immediate.waitUntilFinished(events, 3_000)).toBe('processed');

    const scheduledIds = new Set<string>();
    const repeatSucceeded = new Promise<void>((resolve) => {
      running.on('completed', (job) => {
        if (job.name === 'enrich-metadata' && job.id) scheduledIds.add(job.id);
        if (scheduledIds.size === 2) resolve();
      });
    });
    await queue.upsertJobScheduler(
      'enrich-metadata',
      { every: 500, startDate: new Date(Date.now() + 500) },
      { name: 'enrich-metadata' },
    );
    await repeatSucceeded;
    expect((await queue.getJobScheduler('cheapshark-deals-sync'))?.every).toBe(interval);
    expect((await queue.getJobScheduler('enrich-metadata'))?.every).toBe(500);
  }, 10_000);

  it('runs both exponential-backoff retries and completes on the third attempt', async () => {
    const attempts: { number: number; time: number }[] = [];
    start(async (job) => {
      attempts.push({ number: job.attemptsMade, time: performance.now() });
      if (job.attemptsMade < 2) throw new Error('Temporary fixture failure');
      return 'processed';
    });
    const job = await queue.add('retry-fixture', {});
    expect(await job.waitUntilFinished(events, 12_000)).toBe('processed');
    expect(attempts.map((attempt) => attempt.number)).toEqual([0, 1, 2]);
    expect(attempts[1]!.time - attempts[0]!.time).toBeGreaterThanOrEqual(1900);
    expect(attempts[2]!.time - attempts[1]!.time).toBeGreaterThanOrEqual(3900);
  }, 15_000);

  it('runs alert evaluation and enqueues its notification from a real worker', async () => {
    const now = new Date();
    const listing = {
      id: randomUUID(),
      gameId: randomUUID(),
      storeId: randomUUID(),
      currentPrice: new Prisma.Decimal(4),
      regularPrice: new Prisma.Decimal(10),
      discountPercent: 60,
      currency: 'USD',
      isOnSale: true,
      lastCheckedAt: now,
      store: { name: 'Fixture Store' },
    };
    const alert = {
      id: randomUUID(),
      userId: randomUUID(),
      gameId: listing.gameId,
      storeId: listing.storeId,
      alertType: 'PRICE_BELOW',
      targetPrice: new Prisma.Decimal(5),
      targetDiscountPercent: null,
      currency: 'USD',
      isActive: true,
      lastTriggeredAt: null,
      game: { title: 'Fixture Game' },
    };
    const emailId = randomUUID();
    const createNotification = vi.fn().mockResolvedValue({ id: emailId });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([]),
      notification: { create: createNotification, count: vi.fn().mockResolvedValue(0) },
    };
    const database = {
      storeListing: { findMany: vi.fn().mockResolvedValue([listing]) },
      priceAlert: { findMany: vi.fn().mockResolvedValue([alert]) },
      priceSnapshot: { groupBy: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: alert.id, lastConditionMet: false }]),
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const queueEmail = vi.fn(async (id: string) => {
      await queue.add('send-alert-email', { notificationId: id }, { jobId: 'email-' + id });
    });
    const evaluated = { scrapeRunId: randomUUID(), listingIds: [listing.id] };
    start(async (job) => {
      if (job.name === 'send-alert-email') return null;
      return runAlertEvaluation(job.data as typeof evaluated, {
        database: database as never,
        queueEmail,
        logger: pino({ level: 'silent' }),
        now,
      });
    });
    const job = await queue.add('evaluate-checked-listings', evaluated);
    expect(await job.waitUntilFinished(events, 3_000)).toEqual({
      evaluated: 1,
      fired: 1,
      emailsQueued: 1,
      emailsCapped: 0,
      failed: 0,
    });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(queueEmail).toHaveBeenCalledWith(emailId);
    expect(await queue.getJob('email-' + emailId)).toBeDefined();
  });
});
