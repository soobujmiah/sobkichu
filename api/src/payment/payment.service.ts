/**
 * Payment settlement — the second place atomicity is non-negotiable.
 *
 * Master prompt Section 8: "a payment confirmation and an order-status
 * update should never be able to desync."
 *
 * So one transaction covers all of:
 *   - marking the transaction settled
 *   - transitioning the order to confirmed
 *   - stamping the regulated delivery clock (compliance C4)
 *
 * Three properties this code is built around:
 *
 *  1. IDEMPOTENT. Aggregators retry. A replayed webhook must be a no-op,
 *     not a second settlement. Checked by aggregator_ref, and backstopped
 *     by UNIQUE (aggregator, aggregator_ref) if two arrive concurrently.
 *
 *  2. THE CLOCK STARTS AT ADVANCE PAYMENT, not at order creation and not at
 *     COD delivery. Only an advance settlement stamps a deadline.
 *
 *  3. AMOUNT IS VERIFIED, not trusted. A webhook claiming a different
 *     amount than the pending transaction is rejected -- the aggregator is
 *     an external system and its payload is untrusted input.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { poishaToTaka, takaToPoisha } from '../common/money';
import {
  TransactionContext,
  UNIT_OF_WORK,
  UnitOfWork,
} from '../common/database/unit-of-work';
import { NOTIFICATION_PORT, NotificationPort } from '../common/ports/notification.port';
import { ORDER_PORT, OrderPort } from '../common/ports/order.port';
import { computeDeliveryDeadline } from '../common/compliance/delivery-clock';

import { PaymentRepository } from './payment.repository';

export interface SettlementNotice {
  readonly orderId: string;
  /** sslcommerz | shurjopay | bkash | nagad */
  readonly aggregator: string;
  /** The aggregator's own reference. The idempotency key. */
  readonly aggregatorRef: string;
  /** Amount in poisha, as reported by the aggregator. Verified, not trusted. */
  readonly amount: number;
  readonly outcome: 'settled' | 'failed';
  readonly occurredAt: Date;
}

type CustomerEvent = 'payment_received' | 'payment_failed';

export type SettlementResult =
  | { status: 'applied'; orderId: string; deliveryDeadlineAt: Date | null }
  | { status: 'duplicate'; orderId: string }
  | { status: 'rejected'; reason: string };

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(ORDER_PORT) private readonly orders: OrderPort,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
    private readonly payments: PaymentRepository,
  ) {}

  /**
   * Apply a settlement notice from a payment aggregator.
   *
   * Everything happens in ONE transaction. If any step throws, the whole
   * settlement rolls back and the aggregator's retry finds unchanged state
   * -- which is precisely why retries are safe.
   */
  async applySettlement(notice: SettlementNotice): Promise<SettlementResult> {
    return this.uow.withTransaction(async (tx) => {
      // --- idempotency: has this exact webhook already been applied? -----
      const existing = await this.payments.findByAggregatorRef(
        tx,
        notice.aggregator,
        notice.aggregatorRef,
      );

      if (existing) {
        // Deliberately not an error. A retry is normal aggregator behaviour,
        // and answering 200 stops them retrying forever.
        this.logger.log(
          `Duplicate settlement ignored: ${notice.aggregator}/${notice.aggregatorRef}`,
        );
        return { status: 'duplicate', orderId: existing.order_id };
      }

      const pending = await this.payments.findPendingForOrder(tx, notice.orderId);
      if (!pending) {
        return { status: 'rejected', reason: 'no_pending_transaction' };
      }

      // --- verify the amount against what we recorded --------------------
      // The aggregator is an external system; its payload is untrusted.
      const expected = takaToPoisha(pending.amount_bdt);
      if (notice.amount !== expected) {
        this.logger.warn(
          `Settlement amount mismatch for order ${notice.orderId}: ` +
            `aggregator says ${notice.amount} poisha, expected ${expected}`,
        );
        return { status: 'rejected', reason: 'amount_mismatch' };
      }

      if (notice.outcome === 'failed') {
        await this.payments.markFailed(
          tx,
          pending.id,
          notice.aggregator,
          notice.aggregatorRef,
        );
        await this.orders.transitionStatus(
          tx,
          notice.orderId,
          'awaiting_payment',
          'order.event.payment_failed',
        );
        await this.notifyCustomer(tx, notice, 'payment_failed');
        return { status: 'applied', orderId: notice.orderId, deliveryDeadlineAt: null };
      }

      // --- settle --------------------------------------------------------
      await this.payments.markSettled(
        tx,
        pending.id,
        notice.aggregator,
        notice.aggregatorRef,
        notice.occurredAt,
      );

      await this.orders.transitionStatus(
        tx,
        notice.orderId,
        'confirmed',
        'order.event.payment_received',
      );

      // Queued INSIDE the transaction (Section 8): if the settlement rolls
      // back, so does the promise that we received the money.
      await this.notifyCustomer(tx, notice, 'payment_received');

      // --- the delivery clock (compliance C4) ----------------------------
      // Only an ADVANCE payment starts it. A COD transaction settling on
      // delivery does not retroactively create a delivery deadline.
      if (!pending.is_advance) {
        return { status: 'applied', orderId: notice.orderId, deliveryDeadlineAt: null };
      }

      const order = await this.orders.findForSettlement(tx, notice.orderId);
      if (!order) {
        return { status: 'rejected', reason: 'order_not_found' };
      }

      // Already stamped by an earlier advance: do not restart the clock.
      // Restarting would silently extend a regulated deadline.
      if (order.advancePaidAt) {
        return { status: 'applied', orderId: notice.orderId, deliveryDeadlineAt: null };
      }

      const deadline = computeDeliveryDeadline({
        advancePaidAt: notice.occurredAt,
        sameCity: order.isSameCity,
      });

      await this.orders.startDeliveryClock(
        tx,
        notice.orderId,
        notice.occurredAt,
        deadline.deadlineAt,
      );

      return {
        status: 'applied',
        orderId: notice.orderId,
        deliveryDeadlineAt: deadline.deadlineAt,
      };
    });
  }

  /**
   * Queue the customer notification for a settlement outcome.
   *
   * SMS is mandatory for both outcomes (Section 8); the channel policy in
   * the notification module decides that, not this call site.
   */
  private async notifyCustomer(
    tx: TransactionContext,
    notice: SettlementNotice,
    event: CustomerEvent,
  ): Promise<void> {
    const customer = await this.orders.findCustomer(tx, notice.orderId);
    if (!customer) {
      return;
    }

    await this.notifications.enqueue(tx, {
      userId: customer.customerUserId,
      event,
      params: {
        orderRef: notice.orderId.slice(0, 8),
        amount: poishaToTaka(notice.amount),
      },
      orderId: notice.orderId,
      // Derived from the aggregator reference, not the clock, so a replayed
      // webhook maps to the same key and cannot produce a second SMS.
      dedupeKey: `settle:${notice.aggregator}:${notice.aggregatorRef}:${event}`,
    });
  }
}
