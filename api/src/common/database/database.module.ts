/**
 * Database module — pool and transaction boundary.
 *
 * Global so every module gets the same pool and the same AsyncLocalStorage
 * instance. Two UnitOfWork instances would each open their own transaction
 * and silently break atomicity across a nested call.
 */

import { Global, Module } from '@nestjs/common';

import { pgPoolProvider } from './pg.provider';
import { PgUnitOfWork } from './pg-unit-of-work';
import { UNIT_OF_WORK } from './unit-of-work';

@Global()
@Module({
  providers: [
    pgPoolProvider,
    PgUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: PgUnitOfWork },
  ],
  exports: [pgPoolProvider, UNIT_OF_WORK],
})
export class DatabaseModule {}
