/**
 * Catalog module.
 *
 * Owns `listing` and `category`. Exports CATALOG_PORT so `order` can depend
 * on the contract without importing anything from this module directly
 * (boundary rule 1).
 *
 * Imports IdentityModule and LocationModule (the .module.ts files, for DI
 * wiring only -- boundary rule 3): listing creation gates on the same NID
 * KYC check as order creation (compliance row K1) via MERCHANT_PORT, and
 * denormalises the pickup location's coordinates onto `listing.geo` via
 * LOCATION_PORT so radius search never has to join back to `location`.
 */

import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { LocationModule } from '../location/location.module';

import { CATALOG_PORT } from '../common/ports/catalog.port';

import { CatalogAdapter } from './catalog.adapter';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

@Module({
  imports: [IdentityModule, LocationModule],
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
