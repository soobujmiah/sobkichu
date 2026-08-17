/**
 * Catalog module.
 *
 * Owns `listing` and `category`. Exports CATALOG_PORT so `order` can depend
 * on the contract without importing anything from this module directly
 * (boundary rule 1).
 *
 * Imports IdentityModule (the .module.ts, for DI wiring only -- boundary
 * rule 3) to reach MERCHANT_PORT: listing creation gates on the same NID KYC
 * check as order creation (compliance row K1).
 */

import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';

import { CATALOG_PORT } from '../common/ports/catalog.port';

import { CatalogAdapter } from './catalog.adapter';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

@Module({
  imports: [IdentityModule],
  controllers: [CatalogController],
  providers: [
    CatalogRepository,
    CatalogAdapter,
    CatalogService,
    { provide: CATALOG_PORT, useExisting: CatalogAdapter },
  ],
  exports: [CATALOG_PORT],
})
export class CatalogModule {}
