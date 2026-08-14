/**
 * Application root.
 *
 * Phase 1 modules only. Later-phase modules (dispatch, ledger, community)
 * are wired but flag-gated when they land -- they compile and are tested,
 * and their controllers return 404 while the flag is off (boundary rule 4).
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './common/database/database.module';
import { IdentityModule } from './identity/identity.module';
import { LocationModule } from './location/location.module';
import { OrderModule } from './order/order.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    IdentityModule,
    LocationModule,
    CatalogModule,
    OrderModule,
  ],
})
export class AppModule {}
