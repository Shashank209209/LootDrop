import type { Redis } from 'ioredis';
import type { NegativeCache } from './enrichment.js';

export class RedisNegativeCache implements NegativeCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async find(gameIds: string[]): Promise<Set<string>> {
    if (!gameIds.length) return new Set();
    const values = await this.redis.mget(...gameIds.map((id) => this.key(id)));
    return new Set(gameIds.filter((_, index) => values[index] !== null));
  }

  async remember(gameId: string, reason: string, seconds: number): Promise<void> {
    await this.redis.set(this.key(gameId), reason, 'EX', seconds);
  }

  private key(gameId: string): string {
    return `${this.prefix}:rawg:no-match:${gameId}`;
  }
}
