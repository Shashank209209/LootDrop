import type { Redis } from 'ioredis';
import type { ZodType } from 'zod';

export interface JsonCache {
  get<T>(key: string, schema: ZodType<T>): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export class RedisJsonCache implements JsonCache {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string, schema: ZodType<T>): Promise<T | null> {
    const value = await this.redis.get(key);
    if (value === null) return null;

    try {
      const parsed = schema.safeParse(JSON.parse(value) as unknown);
      if (parsed.success) return parsed.data;
    } catch {
      // Invalid cache entries are treated as misses.
    }

    await this.redis.del(key);
    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
}
