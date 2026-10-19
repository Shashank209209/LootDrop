import { parseArgs } from 'node:util';
import pino from 'pino';
import { env } from '../config/env.js';
import { redis } from '../db/redis.js';
import { enqueueDealsSync } from './sync-deals-queue.js';

const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    pageNumber: { type: 'string' },
    pageSize: { type: 'string' },
    storeID: { type: 'string' },
    steamAppID: { type: 'string' },
    onSale: { type: 'string' },
    upperPrice: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});

const jobInput = {
  title: values.title,
  pageNumber: values.pageNumber === undefined ? 0 : Number(values.pageNumber),
  pageSize: values.pageSize === undefined ? 20 : Number(values.pageSize),
  storeID: values.storeID,
  steamAppID: values.steamAppID === undefined ? undefined : Number(values.steamAppID),
  onSale:
    values.onSale === undefined
      ? undefined
      : values.onSale === 'true'
        ? true
        : values.onSale === 'false'
          ? false
          : values.onSale,
  upperPrice: values.upperPrice === undefined ? undefined : Number(values.upperPrice),
  sortBy: 'DealRating',
};

try {
  const job = await enqueueDealsSync(jobInput);
  pino({ level: env.LOG_LEVEL }).info({ jobId: job.id }, 'Enqueued bounded CheapShark deal query');
} catch (error) {
  console.error('Could not enqueue deal sync', error);
  process.exitCode = 1;
} finally {
  await redis.quit();
}
