import type { Redis } from 'ioredis';
import { z, type ZodTypeAny } from 'zod';

export interface JsonCache {
  get<TSchema extends ZodTypeAny>(key: string, schema: TSchema): Promise<z.output<TSchema> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export class RedisJsonCache implements JsonCache {
  constructor(private readonly redis: Redis) {}

  async get<TSchema extends ZodTypeAny>(
    key: string,
    schema: TSchema,
  ): Promise<z.output<TSchema> | null> {
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
