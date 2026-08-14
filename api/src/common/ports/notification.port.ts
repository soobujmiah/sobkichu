/**
 * Notification port.
 *
 * Called by `order` and `payment` to record an intent to notify. Takes a
 * TransactionContext for the same reason OrderPort does: the outbox row
 * must commit atomically with the state change that caused it.
 *
 * If the row were written outside that transaction, a rollback would leave
 * a notification promising something that never happened -- "your payment
 * was received" for a payment that did not settle.
 */

import { TransactionContext } from '../database/unit-of-work';

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

/**
 * Events that require notification, per the table in
 * docs/engineering/non-functional-requirements.md.
 *
 * Every entry here needs SMS. Push is additive, never a substitute:
 * push delivery cannot be confirmed reliably enough to gate a
 * compliance-relevant notification on it.
 */
export type NotifiableEvent =
  | 'otp'
  | 'order_confirmed'
  | 'payment_received'
  | 'payment_failed'
  | 'out_for_delivery'
  | 'delivered';

export interface NotificationRequest {
  readonly userId: string;
  readonly event: NotifiableEvent;
  /** Substituted into the template at dispatch time. */
  readonly params: Record<string, string>;
  readonly orderId?: string;
  /**
   * Stable key derived from the triggering event, NOT from the clock.
   * Two deliveries of the same webhook must produce the same key so the
   * UNIQUE constraint collapses them into one notification.
   */
  readonly dedupeKey: string;
}

export interface NotificationPort {
  /**
   * Queue a notification. Writes to the outbox inside the caller's
   * transaction; the actual send happens later, out of band.
   */
  enqueue(tx: TransactionContext, request: NotificationRequest): Promise<void>;
}
