/**
 * Template rendering tests.
 *
 * Bangla-first is structural here: `bn` is the source of truth AND the
 * fallback. Falling back to English would quietly serve English to a Bangla
 * speaker, which is the failure the i18n conventions exist to prevent.
 *
 * These run against the real locales/ bundles, so a template deleted from
 * the bundle fails here rather than at dispatch time.
 */

import { MissingTemplateError, knownTemplateKeys, renderTemplate } from './render';

describe('renderTemplate', () => {
  it('renders Bangla by default', () => {
    const message = renderTemplate('notification.payment.received', 'bn', {
      amount: '420.00',
      orderRef: 'a1b2c3d4',
    });

    expect(message.body).toContain('420.00');
    expect(message.body).toContain('a1b2c3d4');
    // Bangla script present.
    expect(message.body).toMatch(/[\u0980-\u09FF]/);
  });

  it('renders English when the user prefers it', () => {
    const message = renderTemplate('notification.payment.received', 'en', {
      amount: '420.00',
      orderRef: 'a1b2c3d4',
    });

    expect(message.body).toBe('Received 420.00 BDT. Order a1b2c3d4 confirmed.');
  });

  it('falls back to Bangla, never to English, for an unknown language', () => {
    const message = renderTemplate('notification.order.confirmed', 'ar', {
      orderRef: 'x',
    });

    expect(message.body).toMatch(/[\u0980-\u09FF]/);
  });

  it('substitutes every placeholder', () => {
    const message = renderTemplate('notification.otp', 'en', { code: '123456' });

    expect(message.body).toBe('Your code is 123456. Do not share it.');
    expect(message.body).not.toContain('{');
  });

  it('throws on a missing parameter rather than shipping a raw placeholder', () => {
    // Sending "Received {amount} BDT" to a user is worse than no message.
    expect(() =>
      renderTemplate('notification.payment.received', 'bn', { orderRef: 'x' }),
    ).toThrow(MissingTemplateError);
  });

  it('throws for an unknown template key', () => {
    expect(() => renderTemplate('notification.nope', 'bn', {})).toThrow(
      MissingTemplateError,
    );
  });

  it('has a bn entry for every template', () => {
    // bn is the fallback, so a template lacking it can fail at dispatch.
    for (const key of knownTemplateKeys()) {
      expect(() => renderTemplate(key, 'zz', sampleParams(key))).not.toThrow();
    }
  });

  it('keeps Bangla SMS bodies short', () => {
    // A Bangla SMS is UCS-2 encoded at 70 characters per segment, versus
    // GSM-7's 160. Verbose Bangla copy costs real money at volume.
    for (const key of knownTemplateKeys()) {
      const message = renderTemplate(key, 'bn', sampleParams(key));
      expect(message.body.length).toBeLessThanOrEqual(140); // <= 2 segments
    }
  });
});

function sampleParams(key: string): Record<string, string> {
  return key === 'notification.otp'
    ? { code: '123456' }
    : { orderRef: 'a1b2c3d4', amount: '420.00' };
}
