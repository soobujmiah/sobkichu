/**
 * Session tokens.
 *
 * A signed, self-contained token: base64url(payload).base64url(hmac).
 *
 * Why not a JWT library: the locked stack (master prompt Section 3) does not
 * include one, and adding a dependency would be a deviation requiring an
 * ADR. The requirement here is narrow -- carry a user id and an active role,
 * signed -- and node:crypto covers it in ~60 lines with no algorithm
 * confusion surface (no `alg: none`, no RS256/HS256 mixups, because there is
 * exactly one algorithm).
 *
 * What the token deliberately does NOT carry: role permissions or KYC state.
 * Those are read from the database per request. A token minted before a
 * merchant's KYC was revoked must not keep asserting they are verified.
 *
 * Pure apart from node:crypto.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Long enough to avoid daily re-login on a shared family phone. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionPayload {
  /** app_user.id */
  readonly sub: string;
  /** Active role id, or null when the user has not switched into one. */
  readonly activeRoleId: string | null;
  /** Issued-at, epoch seconds. */
  readonly iat: number;
  /** Expiry, epoch seconds. */
  readonly exp: number;
}

export type TokenVerification =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadPart: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadPart).digest());
}

export function issueSessionToken(
  userId: string,
  activeRoleId: string | null,
  secret: string,
  now: Date = new Date(),
): string {
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }

  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    sub: userId,
    activeRoleId,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };

  const payloadPart = b64url(JSON.stringify(payload));

  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

/**
 * Verify and decode a token.
 *
 * The signature is checked BEFORE the payload is parsed as meaningful data,
 * so a forged token never reaches application logic.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): TokenVerification {
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed' };
  }

  const [payloadPart, signaturePart] = parts;

  const expected = Buffer.from(sign(payloadPart, secret));
  const provided = Buffer.from(signaturePart);

  if (expected.length !== provided.length) {
    return { valid: false, reason: 'bad_signature' };
  }

  if (!timingSafeEqual(expected, provided)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(payloadPart).toString('utf8')) as SessionPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    return { valid: false, reason: 'malformed' };
  }

  if (Math.floor(now.getTime() / 1000) >= payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload };
}
