/**
 * Database module — pool and transaction boundary.
 *
 * Global so every module gets the same pool and the same AsyncLocalStorage
 * instance. Two UnitOfWork instances would each open their own transaction
 * and silently break atomicity across a nested call.
 */

import { Global, Module } from '@nestjs/common';

import { RATE_LIMITER } from '../rate-limit/rate-limiter';
import { RedisRateLimiter } from '../rate-limit/redis-rate-limiter';

import { pgPoolProvider } from './pg.provider';
import { PgUnitOfWork } from './pg-unit-of-work';
import { redisProvider } from './redis.provider';
import { UNIT_OF_WORK } from './unit-of-work';

@Global()
@Module({
  providers: [
    pgPoolProvider,
    redisProvider,
    PgUnitOfWork,
    RedisRateLimiter,
    { provide: UNIT_OF_WORK, useExisting: PgUnitOfWork },
    { provide: RATE_LIMITER, useExisting: RedisRateLimiter },
  ],
  exports: [pgPoolProvider, redisProvider, UNIT_OF_WORK, RATE_LIMITER],
})
export class DatabaseModule {}
