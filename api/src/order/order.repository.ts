/**
 * Order repository.
 *
 * `order` owns app_order, order_item and order_status_event
 * (docs/architecture/backend-modules.md ownership table).
 *
 * Every method takes a TransactionContext rather than reaching for a pool
 * connection. That is deliberate: it makes it impossible to write half an
 * order outside a transaction, which is how Order/Transaction desync
 * happens in practice.
 */

import { Injectable } from '@nestjs/common';

import { TransactionContext } from '../common/database/unit-of-work';

export type OrderStatus =
  | 'created'
  | 'awaiting_payment'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_pickup'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
  | 'refund_requested'
  | 'refunded';

export interface NewOrderItem {
  readonly listingId: string;
  readonly quantity: number;
  readonly unitPriceBdt: string;
  readonly readyToShipAtOrder: boolean;
}

export interface NewOrderRecord {
  readonly customerUserId: string;
  readonly merchantRoleId: string;
  readonly deliveryLocationId: string;
  readonly paymentMethod: string;
  readonly subtotalBdt: string;
  readonly deliveryFeeBdt: string;
  readonly totalBdt: string;
  readonly advanceAmountBdt: string;
  readonly advanceCapBdt: string;
  readonly isEscrow: boolean;
  readonly allItemsReadyToShip: boolean;
  readonly isSameCity: boolean;
  readonly items: readonly NewOrderItem[];
}

export interface StatusEvent {
  readonly orderId: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly actorRoleId: string | null;
  /** i18n key, never free English text. */
  readonly noteKey: string | null;
}

export interface PendingTransaction {
  readonly orderId: string;
  readonly method: string;
  readonly amountBdt: string;
  readonly isAdvance: boolean;
}

@Injectable()
export class OrderRepository {
  async insertOrder(tx: TransactionContext, record: NewOrderRecord): Promise<string> {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO app_order (
         customer_user_id, merchant_role_id, delivery_location_id,
         status, payment_method,
         subtotal_bdt, delivery_fee_bdt, total_bdt,
         advance_amount_bdt, advance_cap_bdt,
         is_escrow, all_items_ready_to_ship, is_same_city
       ) VALUES ($1,$2,$3,'created',$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        record.customerUserId,
        record.merchantRoleId,
        record.deliveryLocationId,
        record.paymentMethod,
        record.subtotalBdt,
        record.deliveryFeeBdt,
        record.totalBdt,
        record.advanceAmountBdt,
        record.advanceCapBdt,
        record.isEscrow,
        record.allItemsReadyToShip,
        record.isSameCity,
      ],
    );

    return rows[0].id;
  }

  async insertItems(
    tx: TransactionContext,
    orderId: string,
    items: readonly NewOrderItem[],
  ): Promise<void> {
    for (const item of items) {
      await tx.query(
        `INSERT INTO order_item (
           order_id, listing_id, quantity, unit_price_bdt, ready_to_ship_at_order
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          orderId,
          item.listingId,
          item.quantity,
          item.unitPriceBdt,
          item.readyToShipAtOrder,
        ],
      );
    }
  }

  /**
   * Append a status event.
   *
   * Append-only by design: the timeline is retained evidence and must be
   * producible to government entities on request (compliance row C10).
   * Status is never updated by overwriting a single column.
   */
  async recordStatusEvent(tx: TransactionContext, event: StatusEvent): Promise<void> {
    await tx.query(
      `INSERT INTO order_status_event (
         order_id, from_status, to_status, actor_role_id, note_key
       ) VALUES ($1,$2,$3,$4,$5)`,
      [
        event.orderId,
        event.fromStatus,
        event.toStatus,
        event.actorRoleId,
        event.noteKey,
      ],
    );

    await tx.query(`UPDATE app_order SET status = $2, updated_at = now() WHERE id = $1`, [
      event.orderId,
      event.toStatus,
    ]);
  }

  /**
   * Insert the pending Transaction alongside the Order.
   *
   * Written inside the SAME transaction as the order (master prompt
   * Section 8): a payment record and an order must never be able to desync.
   */
  async insertPendingTransaction(
    tx: TransactionContext,
    payment: PendingTransaction,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO transaction (order_id, method, amount_bdt, status, is_advance)
       VALUES ($1,$2,$3,'pending',$4)`,
      [payment.orderId, payment.method, payment.amountBdt, payment.isAdvance],
    );
  }

  /**
   * Stamp the regulated delivery clock (compliance row C4).
   *
   * Called when the advance payment settles, in the same transaction as the
   * settlement write. The 5/10-day window is passed in from the domain layer
   * rather than computed in SQL, so there is one implementation of the rule.
   */
  async stampDeliveryClock(
    tx: TransactionContext,
    orderId: string,
    advancePaidAt: Date,
    deadlineAt: Date,
  ): Promise<void> {
    await tx.query(
      `UPDATE app_order
          SET advance_paid_at = $2, delivery_deadline_at = $3, updated_at = now()
        WHERE id = $1`,
      [orderId, advancePaidAt, deadlineAt],
    );
  }
}
