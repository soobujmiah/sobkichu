/**
 * Order HTTP surface.
 *
 * Thin by design: no business rules here. Everything that affects money or
 * compliance lives in OrderService and the domain layer, so it is testable
 * without HTTP and cannot be bypassed by another caller.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { CreateOrderDto } from './dto/create-order.dto';
import { CreatedOrder, OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateOrderDto): Promise<CreatedOrder> {
    // TODO(identity): customerUserId comes from the authenticated session
    // once the auth guard lands. Role claims are never read from the body --
    // see docs/architecture/backend-modules.md, cross-cutting concerns.
    const customerUserId = '00000000-0000-0000-0000-000000000000';

    return this.orders.createOrder({
      customerUserId,
      merchantRoleId: dto.merchantRoleId,
      deliveryLocationId: dto.deliveryLocationId,
      paymentMethod: dto.paymentMethod,
      lines: dto.lines,
      requestedAdvance: dto.requestedAdvancePoisha,
      // Priced server-side. Zero until the delivery-pricing rule lands;
      // a client-supplied fee would change the advance cap.
      deliveryFee: 0,
    });
  }
}
