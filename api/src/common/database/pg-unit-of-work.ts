/**
 * PostgreSQL implementation of the unit of work.
 *
 * Uses AsyncLocalStorage so a nested `withTransaction` reuses the
 * transaction already in flight instead of opening a second one. Without
 * that, a service calling another service mid-transaction would silently
 * split one atomic sequence into two -- exactly the desync the master
 * prompt forbids.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

import { PG_POOL } from './pg.provider';
import { TransactionContext, UnitOfWork } from './unit-of-work';

class PgTransactionContext implements TransactionContext {
  constructor(private readonly client: PoolClient) {}

  async query<T = unknown>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.client.query(sql, params as unknown[]);
    return result.rows as T[];
  }
}

@Injectable()
export class PgUnitOfWork implements UnitOfWork {
  private readonly storage = new AsyncLocalStorage<TransactionContext>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const existing = this.storage.getStore();
    if (existing) {
      // Already inside a transaction: join it. Opening a nested BEGIN here
      // would break atomicity for the outer caller.
      return work(existing);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const context = new PgTransactionContext(client);

      const result = await this.storage.run(context, () => work(context));

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
