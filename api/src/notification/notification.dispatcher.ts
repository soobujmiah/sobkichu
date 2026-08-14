/**
 * Outbox dispatcher.
 *
 * Reads pending notifications and calls the gateways. Runs separately from
 * the transaction that queued them, which is the whole point of the outbox:
 * a slow SMS gateway must never hold a payment transaction open, and a
 * gateway failure must never roll back a settled payment.
 *
 * Delivery is AT-LEAST-ONCE. For a channel a user relies on to learn their
 * money moved, a rare duplicate SMS is a better failure than a silent miss.
 * The dedupe_key constraint keeps duplicates rare in practice.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { UNIT_OF_WORK, UnitOfWork } from '../common/database/unit-of-work';

import { PUSH_GATEWAY, PushGateway, SMS_GATEWAY, SmsGateway } from './gateways';
import { NotificationRepository, OutboxRow } from './notification.repository';
import { renderTemplate } from './domain/render';

/** Give up after this many attempts; a bad number must not retry forever. */
const MAX_ATTEMPTS = 5;

/** Bounded so one pass cannot monopolise a connection. */
const BATCH_SIZE = 50;

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
}

@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(SMS_GATEWAY) private readonly sms: SmsGateway,
    @Inject(PUSH_GATEWAY) private readonly push: PushGateway,
    private readonly outbox: NotificationRepository,
  ) {}

  /**
   * Dispatch one batch.
   *
   * Each notification is claimed, sent and marked in its own transaction.
   * One transaction for the whole batch would mean a single gateway failure
   * rolls back every successful send in it, causing duplicates on retry.
   */
  async dispatchBatch(limit = BATCH_SIZE): Promise<DispatchSummary> {
    const summary: DispatchSummary = { claimed: 0, sent: 0, failed: 0 };

    const pending = await this.uow.withTransaction((tx) =>
      this.outbox.claimPending(tx, limit),
    );

    summary.claimed = pending.length;

    for (const row of pending) {
      const outcome = await this.deliver(row);
      if (outcome === 'sent') {
        summary.sent += 1;
      } else {
        summary.failed += 1;
      }
    }

    return summary;
  }

  private async deliver(row: OutboxRow): Promise<'sent' | 'failed'> {
    try {
      const message = renderTemplate(row.template_key, row.language, row.params);

      if (row.channel === 'sms') {
        await this.sms.send(row.phone_e164, message.body);
      } else {
        await this.push.send(row.user_id, message.title, message.body);
      }

      await this.uow.withTransaction((tx) => this.outbox.markSent(tx, row.id));
      return 'sent';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      // An abandoned SMS means a user was never told something they were
      // entitled to know. Log loudly rather than burying it.
      if (row.attempts + 1 >= MAX_ATTEMPTS && row.channel === 'sms') {
        this.logger.error(
          `Abandoning required SMS ${row.id} (${row.template_key}) after ` +
            `${MAX_ATTEMPTS} attempts: ${reason}`,
        );
      }

      await this.uow.withTransaction((tx) =>
        this.outbox.markFailed(tx, row.id, reason, MAX_ATTEMPTS),
      );
      return 'failed';
    }
  }
}
