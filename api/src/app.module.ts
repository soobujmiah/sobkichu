/**
 * Application root.
 *
 * Phase 1 modules only. Later-phase modules (dispatch, ledger, community)
 * are wired but flag-gated when they land -- they compile and are tested,
 * and their controllers return 404 while the flag is off (boundary rule 4).
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './common/database/database.module';
import { AuthGuard } from './identity/auth.guard';
import { IdentityModule } from './identity/identity.module';
import { LocationModule } from './location/location.module';
import { NotificationModule } from './notification/notification.module';
import { OrderModule } from './order/order.module';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    NotificationModule,
    IdentityModule,
    LocationModule,
    CatalogModule,
    OrderModule,
    PaymentModule,
  ],
  providers: [
    // Global: a new endpoint is protected by default. Opt out explicitly
    // with @Public(). The failure mode of opt-in auth is a forgotten
    // decorator on an endpoint that moves money.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
