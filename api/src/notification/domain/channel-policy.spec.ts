/**
 * Channel policy tests.
 *
 * Master prompt Section 8 makes SMS mandatory, not a fallback. These tests
 * exist so that requirement cannot be quietly weakened -- including by
 * someone adding a new event and forgetting SMS.
 */

import { NotifiableEvent } from '../../common/ports/notification.port';
import { knownTemplateKeys } from './render';
import {
  channelsFor,
  knownEvents,
  requiresSms,
  templateKeyFor,
} from './channel-policy';

describe('channel policy', () => {
  describe('SMS is mandatory (Section 8)', () => {
    it.each(knownEvents())('requires SMS for %s', (event) => {
      expect(requiresSms(event)).toBe(true);
      expect(channelsFor(event)).toContain('sms');
    });

    it('requires SMS for EVERY known event, with no exceptions', () => {
      // Written as an all-events assertion rather than a list, so adding an
      // event without SMS fails here instead of shipping.
      const withoutSms = knownEvents().filter((event) => !requiresSms(event));

      expect(withoutSms).toEqual([]);
    });

    it('never returns an empty channel list', () => {
      for (const event of knownEvents()) {
        expect(channelsFor(event).length).toBeGreaterThan(0);
      }
    });
  });

  describe('push', () => {
    it('sends order and delivery events on push as well', () => {
      expect(channelsFor('order_confirmed')).toEqual(['push', 'sms']);
      expect(channelsFor('payment_received')).toEqual(['push', 'sms']);
      expect(channelsFor('delivered')).toEqual(['push', 'sms']);
    });

    it('does NOT push an OTP', () => {
      // A login code delivered to the app you are trying to log into is
      // useless, and on a feature phone there is no app at all.
      expect(channelsFor('otp')).toEqual(['sms']);
    });
  });

  describe('templates', () => {
    it('maps every event to a template key', () => {
      for (const event of knownEvents()) {
        expect(templateKeyFor(event)).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      }
    });

    it('has a real template behind every policy entry', () => {
      // Guards the gap where a policy names a key the renderer lacks --
      // which would fail at dispatch time, after the state change committed.
      const templates = knownTemplateKeys();

      for (const event of knownEvents()) {
        expect(templates).toContain(templateKeyFor(event));
      }
    });
  });

  it('throws for an unknown event rather than silently sending nothing', () => {
    expect(() => channelsFor('not_an_event' as NotifiableEvent)).toThrow();
    expect(() => templateKeyFor('not_an_event' as NotifiableEvent)).toThrow();
  });
});
