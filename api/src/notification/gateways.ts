/**
 * Outbound gateway interfaces.
 *
 * Kept behind interfaces so the dispatcher is testable without network
 * access, and so swapping SMS providers is a provider change rather than a
 * dispatcher rewrite.
 *
 * No real provider is wired yet: credentials come from GitHub Actions
 * secrets (SMS_GATEWAY_KEY, FCM_SERVER_KEY) and the provider has not been
 * selected. The no-op implementations below log and succeed, so the outbox
 * path is exercisable end to end before that decision lands.
 */

import { Injectable, Logger } from '@nestjs/common';

export const SMS_GATEWAY = Symbol('SMS_GATEWAY');
export const PUSH_GATEWAY = Symbol('PUSH_GATEWAY');

export interface SmsGateway {
  /** Throws on failure; the dispatcher records the attempt and retries. */
  send(phoneE164: string, body: string): Promise<void>;
}

export interface PushGateway {
  send(userId: string, title: string, body: string): Promise<void>;
}

/**
 * Placeholder SMS gateway.
 *
 * Deliberately logs at warn: a Phase 1 deployment running with this wired
 * in is NOT meeting the mandatory-SMS requirement, and that should be
 * visible in logs rather than silently passing.
 */
@Injectable()
export class LoggingSmsGateway implements SmsGateway {
  private readonly logger = new Logger(LoggingSmsGateway.name);

  async send(phoneE164: string, body: string): Promise<void> {
    const masked = phoneE164.replace(/(\+\d{3})\d+(\d{2})/, '$1******$2');
    this.logger.warn(`SMS NOT SENT (no provider configured) to ${masked}: ${body}`);
  }
}

@Injectable()
export class LoggingPushGateway implements PushGateway {
  private readonly logger = new Logger(LoggingPushGateway.name);

  async send(userId: string, title: string, body: string): Promise<void> {
    this.logger.debug(
      `Push not sent (no provider configured) to ${userId}: ${title} ${body}`,
    );
  }
}
