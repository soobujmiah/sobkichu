/**
 * Notification outbox repository.
 *
 * `notification` owns notification_outbox.
 */

import { Injectable } from '@nestjs/common';

import { TransactionContext } from '../common/database/unit-of-work';

export interface OutboxEntry {
  readonly userId: string;
  readonly phoneE164: string;
  readonly language: string;
  readonly channel: string;
  readonly templateKey: string;
  readonly params: Record<string, string>;
  readonly orderId: string | null;
  readonly dedupeKey: string;
}

export interface OutboxRow {
  id: string;
  user_id: string;
  phone_e164: string;
  language: string;
  channel: string;
  template_key: string;
  params: Record<string, string>;
  order_id: string | null;
  status: string;
  attempts: number;
}

@Injectable()
export class NotificationRepository {
  /**
   * Queue a notification.
   *
   * ON CONFLICT DO NOTHING against dedupe_key: a replayed webhook must not
   * produce a second SMS. The application already ignores replays; this is
   * the backstop for the case where two arrive concurrently and both pass
   * the application check.
   */
  async enqueue(tx: TransactionContext, entry: OutboxEntry): Promise<void> {
    await tx.query(
      `INSERT INTO notification_outbox (
         user_id, phone_e164, language, channel,
         template_key, params, order_id, dedupe_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        entry.userId,
        entry.phoneE164,
        entry.language,
        entry.channel,
        entry.templateKey,
        JSON.stringify(entry.params),
        entry.orderId,
        entry.dedupeKey,
      ],
    );
  }

  /**
   * Claim a batch of pending notifications for dispatch.
   *
   * FOR UPDATE SKIP LOCKED so multiple dispatcher instances can run without
   * sending the same notification twice -- each claims a disjoint set.
   */
  async claimPending(tx: TransactionContext, limit: number): Promise<OutboxRow[]> {
    return tx.query<OutboxRow>(
      `SELECT id, user_id, phone_e164, language, channel,
              template_key, params, order_id, status, attempts
         FROM notification_outbox
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [limit],
    );
  }

  async markSent(tx: TransactionContext, id: string): Promise<void> {
    await tx.query(
      `UPDATE notification_outbox
          SET status = 'sent', sent_at = now(), attempts = attempts + 1
        WHERE id = $1`,
      [id],
    );
  }

  /**
   * Record a failed attempt.
   *
   * Abandoned after maxAttempts so a permanently bad number does not retry
   * forever. Abandoned rows stay in the table as evidence that a required
   * notification did not reach the user.
   */
  async markFailed(
    tx: TransactionContext,
    id: string,
    error: string,
    maxAttempts: number,
  ): Promise<void> {
    await tx.query(
      `UPDATE notification_outbox
          SET attempts = attempts + 1,
              last_error = $2,
              status = CASE WHEN attempts + 1 >= $3 THEN 'abandoned'::notification_status
                            ELSE 'pending'::notification_status END
        WHERE id = $1`,
      [id, error.slice(0, 500), maxAttempts],
    );
  }
}
