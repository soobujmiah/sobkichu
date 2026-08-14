/**
 * Order adapter — implements OrderPort for the `payment` module.
 *
 * Lets `payment` move an order forward without touching app_order or
 * order_status_event itself, while keeping the whole settlement in one
 * transaction (the context is passed in, never created here).
 */

import { Injectable } from '@nestjs/common';

import { TransactionContext } from '../common/database/unit-of-work';
import {
  OrderCustomer,
  OrderForSettlement,
  OrderPort,
} from '../common/ports/order.port';

import { OrderRepository, OrderStatus } from './order.repository';

interface OrderRow {
  id: string;
  is_same_city: boolean;
  advance_paid_at: Date | null;
  status: string;
}

@Injectable()
export class OrderAdapter implements OrderPort {
  constructor(private readonly orders: OrderRepository) {}

  async findForSettlement(
    tx: TransactionContext,
    orderId: string,
  ): Promise<OrderForSettlement | null> {
    const rows = await tx.query<OrderRow>(
      `SELECT id, is_same_city, advance_paid_at, status
         FROM app_order
        WHERE id = $1`,
      [orderId],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      orderId: row.id,
      isSameCity: row.is_same_city,
      advancePaidAt: row.advance_paid_at,
      status: row.status,
    };
  }

  async findCustomer(
    tx: TransactionContext,
    orderId: string,
  ): Promise<OrderCustomer | null> {
    const rows = await tx.query<{ customer_user_id: string }>(
      'SELECT customer_user_id FROM app_order WHERE id = $1',
      [orderId],
    );

    return rows[0] ? { customerUserId: rows[0].customer_user_id } : null;
  }

  async transitionStatus(
    tx: TransactionContext,
    orderId: string,
    toStatus: string,
    noteKey: string,
  ): Promise<void> {
    const rows = await tx.query<{ status: OrderStatus }>(
      'SELECT status FROM app_order WHERE id = $1',
      [orderId],
    );

    await this.orders.recordStatusEvent(tx, {
      orderId,
      fromStatus: rows[0]?.status ?? null,
      toStatus: toStatus as OrderStatus,
      actorRoleId: null,
      noteKey,
    });
  }

  async startDeliveryClock(
    tx: TransactionContext,
    orderId: string,
    advancePaidAt: Date,
    deadlineAt: Date,
  ): Promise<void> {
    await this.orders.stampDeliveryClock(tx, orderId, advancePaidAt, deadlineAt);
  }
}
