/**
 * Order port — the interface `payment` calls to move an order forward.
 *
 * Per the ownership table, `order` owns app_order and order_status_event and
 * "may be called by" payment. This is that call.
 *
 * THE IMPORTANT DETAIL: every method takes a TransactionContext.
 *
 * A payment settlement and the order-status update it causes must land in
 * ONE database transaction (master prompt Section 8). If this port opened
 * its own transaction, settling a payment and confirming an order would be
 * two commits, and a crash between them would leave a paid order stuck
 * unconfirmed -- exactly the desync the constraint forbids.
 *
 * Passing the context across the module boundary keeps atomicity intact
 * while still preventing `payment` from touching order's tables directly.
 */

import { TransactionContext } from '../database/unit-of-work';

export const ORDER_PORT = Symbol('ORDER_PORT');

export interface OrderForSettlement {
  readonly orderId: string;
  readonly isSameCity: boolean;
  /** Already-settled advance, if any. Null when the clock has not started. */
  readonly advancePaidAt: Date | null;
  readonly status: string;
}

export interface OrderCustomer {
  readonly customerUserId: string;
}

export interface OrderPort {
  /** Who to notify about this order. */
  findCustomer(tx: TransactionContext, orderId: string): Promise<OrderCustomer | null>;

  /** Read the order facts needed to settle a payment against it. */
  findForSettlement(
    tx: TransactionContext,
    orderId: string,
  ): Promise<OrderForSettlement | null>;

  /**
   * Advance the order's status, appending to the event timeline.
   * Append-only: the timeline is retained evidence (compliance C10).
   */
  transitionStatus(
    tx: TransactionContext,
    orderId: string,
    toStatus: string,
    noteKey: string,
  ): Promise<void>;

  /**
   * Stamp the regulated delivery clock (compliance C4).
   *
   * Called only when an ADVANCE payment settles, because the guideline
   * measures the 5/10-day window from advance payment. A COD order has no
   * advance and therefore no deadline until money changes hands.
   */
  startDeliveryClock(
    tx: TransactionContext,
    orderId: string,
    advancePaidAt: Date,
    deadlineAt: Date,
  ): Promise<void>;
}
