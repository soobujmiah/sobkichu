/**
 * Webhook signature verification tests.
 *
 * This endpoint moves money state and starts a regulated delivery clock, so
 * a forged request could confirm orders nobody paid for.
 */

import { createHmac } from 'node:crypto';

import { verifyWebhookSignature } from './webhook-signature';

const SECRET = 'test-secret';
const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ orderId: 'abc', amountPoisha: 42000 });

  it('accepts a correctly signed body', () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('accepts a Buffer body identically to a string', () => {
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = sign(body);
    const tampered = JSON.stringify({ orderId: 'abc', amountPoisha: 1 });

    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyWebhookSignature(body, sign(body, 'wrong'), SECRET)).toBe(false);
  });

  it('rejects an empty or missing signature', () => {
    expect(verifyWebhookSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects when no secret is configured, rather than passing', () => {
    // Fail closed: an unconfigured secret must never mean "accept".
    expect(verifyWebhookSignature(body, sign(body), '')).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on length mismatch; that must be handled, not
    // surfaced as a 500 that leaks length information.
    expect(() => verifyWebhookSignature(body, 'abcd', SECRET)).not.toThrow();
    expect(verifyWebhookSignature(body, 'abcd', SECRET)).toBe(false);
  });

  it('rejects non-hex input without throwing', () => {
    expect(() => verifyWebhookSignature(body, 'zzzz', SECRET)).not.toThrow();
    expect(verifyWebhookSignature(body, 'zzzz', SECRET)).toBe(false);
  });

  it('is sensitive to byte-level differences in whitespace', () => {
    // Why the raw body matters: re-serialising JSON can change bytes and
    // break a valid signature.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);

    expect(verifyWebhookSignature(reserialised, sign(body), SECRET)).toBe(false);
  });
});
