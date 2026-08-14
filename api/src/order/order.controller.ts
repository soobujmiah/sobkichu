/**
 * Order HTTP surface.
 *
 * Thin by design: no business rules here. Everything that affects money or
 * compliance lives in OrderService and the domain layer, so it is testable
 * without HTTP and cannot be bypassed by another caller.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthenticatedCaller } from '../identity/auth.guard';
import { Caller } from '../identity/caller.decorator';

import { CreateOrderDto } from './dto/create-order.dto';
import { CreatedOrder, OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateOrderDto,
    @Caller() caller: AuthenticatedCaller,
  ): Promise<CreatedOrder> {
    return this.orders.createOrder({
      // From the verified session, never from the body: reading it from the
      // request would let any client place orders as any user.
      customerUserId: caller.userId,
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
