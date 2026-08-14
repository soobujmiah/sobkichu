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

import { DatabaseModule } from '../common/database/database.module';

import { OrderController } from './order.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  imports: [DatabaseModule],
  controllers: [OrderController],
  providers: [OrderService, OrderRepository],
  exports: [OrderService],
})
export class OrderModule {}
