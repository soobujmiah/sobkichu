/**
 * Redis-backed fixed-window rate limiter.
 *
 * INCR + EXPIRE in a pipeline: the counter and its TTL are set together, so
 * a crash between them cannot leave a key that never expires and locks a
 * user out permanently.
 *
 * Fails OPEN. If Redis is unavailable, requests are allowed rather than
 * rejected -- an outage in a protective layer must not take down checkout.
 * The trade-off is accepted deliberately: the alternative turns a cache
 * outage into a full service outage, which is worse than briefly
 * unthrottled traffic.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';

import { REDIS_CLIENT } from '../database/redis.provider';

import { RateLimitDecision, RateLimiter } from './rate-limiter';

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  private readonly logger = new Logger(RedisRateLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision> {
    const namespaced = `ratelimit:${key}`;

    try {
      const [count, ttl] = await this.redis
        .multi()
        .incr(namespaced)
        .expire(namespaced, windowSeconds, 'NX')
        .ttl(namespaced)
        .exec()
        .then((replies) => [Number(replies[0]), Number(replies[2])]);

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    } catch (error) {
      this.logger.error(
        `Rate limiter unavailable, failing open for ${key}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );

      return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
    }
  }
}
