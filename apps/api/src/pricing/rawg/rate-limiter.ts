import type { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import type { RequestLimiter } from '../rate-limiter.js';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class RawgRateLimiter implements RequestLimiter {
  private readonly limiter: RateLimiterRedis;

  constructor(redis: Redis) {
    this.limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rawg:rate-limit',
      points: 1,
      duration: 1,
      blockDuration: 1,
    });
  }

  async waitForPermit(): Promise<void> {
    while (true) {
      try {
        await this.limiter.consume('global');
        return;
      } catch (error) {
        const waitMilliseconds =
          typeof error === 'object' && error !== null && 'msBeforeNext' in error
            ? Number(error.msBeforeNext)
            : null;
        if (waitMilliseconds === null || !Number.isFinite(waitMilliseconds)) throw error;
        await delay(Math.max(1, waitMilliseconds));
      }
    }
  }
}
