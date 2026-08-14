/**
 * Channel policy — which channels each event must use.
 *
 * Master prompt Section 8, and the table in
 * docs/engineering/non-functional-requirements.md:
 *
 *   "Order confirmations, OTPs, and critical status changes go via SMS as
 *    well as push. Feature phones and low-data users are a real segment,
 *    not an edge case."
 *
 *   "SMS is not a retry-on-push-failure mechanism for these events; it is
 *    sent alongside."
 *
 * Encoded as data rather than scattered through call sites so that
 * "does this event require SMS?" has exactly one answer, and so a new event
 * cannot quietly ship without one.
 *
 * Pure: no framework, no I/O.
 */

import { NotifiableEvent } from '../../common/ports/notification.port';

export type Channel = 'push' | 'sms';

interface Policy {
  /** SMS is required for every compliance-relevant event. */
  readonly sms: boolean;
  readonly push: boolean;
  /** i18n key. Never rendered text -- composed per recipient at dispatch. */
  readonly templateKey: string;
}

/**
 * The policy table, mirroring the NFR document row for row.
 *
 * OTP is push: false deliberately -- a login code delivered to the app you
 * are trying to log into is useless, and on a feature phone there is no app
 * at all.
 */
const POLICIES: Record<NotifiableEvent, Policy> = {
  otp: { sms: true, push: false, templateKey: 'notification.otp' },
  order_confirmed: {
    sms: true,
    push: true,
    templateKey: 'notification.order.confirmed',
  },
  payment_received: {
    sms: true,
    push: true,
    templateKey: 'notification.payment.received',
  },
  payment_failed: {
    sms: true,
    push: true,
    templateKey: 'notification.payment.failed',
  },
  out_for_delivery: {
    sms: true,
    push: true,
    templateKey: 'notification.delivery.out_for_delivery',
  },
  delivered: { sms: true, push: true, templateKey: 'notification.delivery.delivered' },
};

/** Channels this event must be delivered on. Never empty. */
export function channelsFor(event: NotifiableEvent): Channel[] {
  const policy = POLICIES[event];

  if (!policy) {
    // A new event with no policy is a programming error, not a reason to
    // silently send nothing.
    throw new Error(`No channel policy defined for event: ${event}`);
  }

  const channels: Channel[] = [];
  if (policy.push) {
    channels.push('push');
  }
  if (policy.sms) {
    channels.push('sms');
  }

  return channels;
}

export function templateKeyFor(event: NotifiableEvent): string {
  const policy = POLICIES[event];

  if (!policy) {
    throw new Error(`No channel policy defined for event: ${event}`);
  }

  return policy.templateKey;
}

/** Every event this policy table knows about. Used to assert coverage. */
export function knownEvents(): NotifiableEvent[] {
  return Object.keys(POLICIES) as NotifiableEvent[];
}

/**
 * Whether SMS is mandatory for this event.
 *
 * Exposed separately so the requirement is directly assertable in tests
 * rather than inferred from a channel list.
 */
export function requiresSms(event: NotifiableEvent): boolean {
  return POLICIES[event]?.sms === true;
}
