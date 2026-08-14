/**
 * OTP challenge storage.
 *
 * Redis, not Postgres: challenges are ephemeral by design and expire on
 * their own. A challenge lost to a Redis restart is a re-request, not lost
 * data -- and the TTL means an abandoned login leaves nothing behind.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { RedisClientType } from 'redis';

import { REDIS_CLIENT } from '../common/database/redis.provider';

import { OTP_TTL_SECONDS, OtpChallenge } from './domain/otp';

interface StoredChallenge {
  codeHash: string;
  expiresAt: string;
  attempts: number;
}

@Injectable()
export class OtpStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  private key(phone: string): string {
    return `otp:${phone}`;
  }

  async save(phone: string, challenge: OtpChallenge): Promise<void> {
    const stored: StoredChallenge = {
      codeHash: challenge.codeHash,
      expiresAt: challenge.expiresAt.toISOString(),
      attempts: challenge.attempts,
    };

    // Overwrites any previous challenge: requesting a new code must
    // invalidate the old one, or two live codes exist at once.
    await this.redis.set(this.key(phone), JSON.stringify(stored), {
      EX: OTP_TTL_SECONDS,
    });
  }

  async load(phone: string): Promise<OtpChallenge | null> {
    const raw = await this.redis.get(this.key(phone));
    if (!raw) {
      return null;
    }

    const stored = JSON.parse(raw) as StoredChallenge;

    return {
      codeHash: stored.codeHash,
      expiresAt: new Date(stored.expiresAt),
      attempts: stored.attempts,
    };
  }

  /**
   * Increment the attempt counter.
   *
   * Preserves the original TTL: a wrong guess must not extend the window an
   * attacker has to keep guessing.
   */
  async recordAttempt(phone: string, challenge: OtpChallenge): Promise<void> {
    const key = this.key(phone);
    const ttl = await this.redis.ttl(key);

    if (ttl <= 0) {
      return;
    }

    const stored: StoredChallenge = {
      codeHash: challenge.codeHash,
      expiresAt: challenge.expiresAt.toISOString(),
      attempts: challenge.attempts + 1,
    };

    await this.redis.set(key, JSON.stringify(stored), { EX: ttl });
  }

  /** Single use: a verified code is destroyed so it cannot be replayed. */
  async consume(phone: string): Promise<void> {
    await this.redis.del(this.key(phone));
  }
}
