/**
 * Payment module. Owns the `transaction` table.
 *
 * Depends on ORDER_PORT to move orders forward, so it never touches
 * app_order or order_status_event directly.
 */

import { Module } from '@nestjs/common';

import { OrderModule } from '../order/order.module';

import { PaymentController } from './payment.controller';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';

@Module({
  imports: [OrderModule],
  controllers: [PaymentController],
  providers: [PaymentRepository, PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
