/**
 * Catalog module.
 *
 * Owns `listing` and `category`. Exports CATALOG_PORT so `order` can depend
 * on the contract without importing anything from this module directly
 * (boundary rule 1).
 */

import { Module } from '@nestjs/common';

import { CATALOG_PORT } from '../common/ports/catalog.port';

import { CatalogAdapter } from './catalog.adapter';
import { CatalogRepository } from './catalog.repository';

@Module({
  providers: [
    CatalogRepository,
    CatalogAdapter,
    { provide: CATALOG_PORT, useExisting: CatalogAdapter },
  ],
  exports: [CATALOG_PORT],
})
export class CatalogModule {}
