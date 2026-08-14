/**
 * Order module.
 *
 * Owns app_order, order_item, order_status_event.
 *
 * Depends on catalog, location and identity through PORTS declared in
 * common/ports, never by importing those modules directly. Dependencies
 * point downward (boundary rule 3) and the ESLint no-restricted-imports rule
 * enforces it.
 */

import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseModule } from '../common/database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { LocationModule } from '../location/location.module';

import { ORDER_PORT } from '../common/ports/order.port';

import { OrderAdapter } from './order.adapter';
import { OrderController } from './order.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  imports: [DatabaseModule, CatalogModule, LocationModule, IdentityModule],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderRepository,
    OrderAdapter,
    { provide: ORDER_PORT, useExisting: OrderAdapter },
  ],
  exports: [OrderService, ORDER_PORT],
})
export class OrderModule {}
