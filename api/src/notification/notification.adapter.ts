/**
 * Notification adapter — implements NotificationPort.
 *
 * Writes outbox rows inside the caller's transaction. One row per required
 * channel, so a push failure can never suppress the mandatory SMS.
 */

import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '../common/database/pg.provider';
import { TransactionContext } from '../common/database/unit-of-work';
import {
  NotificationPort,
  NotificationRequest,
} from '../common/ports/notification.port';

import { channelsFor, templateKeyFor } from './domain/channel-policy';
import { NotificationRepository } from './notification.repository';

interface RecipientRow {
  phone_e164: string;
  language_preference: string;
}

@Injectable()
export class NotificationAdapter implements NotificationPort {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly outbox: NotificationRepository,
  ) {}

  async enqueue(tx: TransactionContext, request: NotificationRequest): Promise<void> {
    // Read the recipient through the transaction: if the caller's work rolls
    // back, this read was never meaningful anyway.
    const rows = await tx.query<RecipientRow>(
      'SELECT phone_e164, language_preference FROM app_user WHERE id = $1',
      [request.userId],
    );

    const recipient = rows[0];
    if (!recipient) {
      // Developer-facing: a notification for a nonexistent user means the
      // caller passed a bad id, which should surface loudly.
      throw new Error(`Cannot notify unknown user: ${request.userId}`);
    }

    const templateKey = templateKeyFor(request.event);

    // One row per channel. Separate rows mean a failing push cannot take the
    // SMS down with it, and each retries independently.
    for (const channel of channelsFor(request.event)) {
      await this.outbox.enqueue(tx, {
        userId: request.userId,
        phoneE164: recipient.phone_e164,
        language: recipient.language_preference,
        channel,
        templateKey,
        params: request.params,
        orderId: request.orderId ?? null,
        // Channel-scoped so push and SMS for the same event do not collide
        // on the UNIQUE constraint.
        dedupeKey: `${request.dedupeKey}:${channel}`,
      });
    }
  }
}
