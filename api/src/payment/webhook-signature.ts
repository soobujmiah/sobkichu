/**
 * Webhook signature verification.
 *
 * A settlement webhook moves money state and starts a regulated delivery
 * clock. An unauthenticated endpoint that does that is a way to confirm
 * orders nobody paid for, so the signature check is not optional.
 *
 * Pure and dependency-free apart from node:crypto, so it is directly
 * testable without HTTP.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify an HMAC-SHA256 signature over the raw request body.
 *
 * Two details that matter:
 *
 *  1. Verifies the RAW body, not a re-serialised object. JSON.stringify does
 *     not guarantee key order or spacing, so re-serialising can produce a
 *     different byte sequence and fail a valid signature.
 *
 *  2. Uses timingSafeEqual. A plain === leaks how many leading bytes matched,
 *     which is enough to forge a signature byte by byte given enough
 *     attempts.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHex: string,
  secret: string,
): boolean {
  if (!signatureHex || !secret) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }

  // timingSafeEqual throws on length mismatch, which would itself leak
  // length information through the error path. Check first.
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
