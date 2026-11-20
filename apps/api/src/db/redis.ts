import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const queuePrefix = process.env.BULLMQ_PREFIX || 'bull';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
