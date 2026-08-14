/**
 * PostgreSQL connection pool.
 *
 * Connection details come from environment configuration, which in turn
 * comes from GitHub Actions secrets and repo environment config -- not from
 * a committed .env (master prompt Section 4).
 */

import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

export const pgPoolProvider: Provider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Pool => {
    const connectionString = config.get<string>('DATABASE_URL');

    if (!connectionString) {
      // Developer-facing: a missing connection string is a deployment
      // error, not something a user ever sees.
      throw new Error('DATABASE_URL is not configured');
    }

    return new Pool({
      connectionString,
      // Sized for Phase 1 scale: single-city, tens of thousands of DAU
      // (master prompt Section 8). Not over-provisioned for a scale that
      // does not exist yet.
      max: Number(config.get('PG_POOL_MAX') ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  },
};
