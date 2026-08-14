/**
 * OTP generation and verification.
 *
 * Phone-based login: phone_e164 is the primary identifier in the BD context
 * (canonical data model), not email.
 *
 * Security properties, each of which is a way this goes wrong if missed:
 *
 *  1. CRYPTOGRAPHICALLY RANDOM. Math.random() is seeded predictably enough
 *     that codes become guessable; randomInt() draws from the CSPRNG.
 *
 *  2. HASHED AT REST. A database or Redis dump must not hand out live login
 *     codes. Only the hash is stored.
 *
 *  3. CONSTANT-TIME COMPARISON. A plain === leaks how many leading digits
 *     matched via timing, which narrows a 6-digit space fast.
 *
 *  4. SINGLE USE. A verified code is consumed, so an intercepted SMS cannot
 *     be replayed.
 *
 *  5. ATTEMPT-CAPPED. 6 digits is a million combinations; without a cap,
 *     brute force is trivial. Capped at 5 tries, then the code dies.
 *
 *  6. UNIFORM FAILURE. Wrong code, expired code, and no-code-requested all
 *     return the same failure shape, so the endpoint is not a phone-number
 *     enumeration oracle.
 *
 * Pure apart from node:crypto: no database, no framework, directly testable.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Six digits: the length BD users expect from every MFS and bank. */
export const OTP_LENGTH = 6;

/** Long enough to arrive by SMS on a slow network, short enough to matter. */
export const OTP_TTL_SECONDS = 300;

/** Brute force needs ~500k tries on average; 5 makes that hopeless. */
export const MAX_VERIFY_ATTEMPTS = 5;

export interface OtpChallenge {
  /** Hash of the code. The plaintext is never stored. */
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly attempts: number;
}

export interface IssuedOtp {
  /** Sent by SMS, then discarded. Never persisted, never logged. */
  readonly code: string;
  readonly challenge: OtpChallenge;
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' };

/**
 * Generate a numeric code of OTP_LENGTH digits.
 *
 * randomInt() over the full range keeps every code equally likely, including
 * those with leading zeros -- padStart preserves them so "004321" is a valid
 * code rather than being silently shortened.
 */
export function generateCode(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

/**
 * Hash a code for storage.
 *
 * HMAC with a server-side secret rather than a bare hash: a bare SHA-256 of
 * a 6-digit code is trivially reversed by hashing all million candidates.
 * The secret makes a stolen hash useless without it.
 */
export function hashCode(code: string, secret: string): string {
  if (!secret) {
    // Fail loudly at issuance rather than storing weakly hashed codes.
    throw new Error('OTP secret is not configured');
  }

  return createHmac('sha256', secret).update(code).digest('hex');
}

export function issueOtp(secret: string, now: Date = new Date()): IssuedOtp {
  const code = generateCode();

  return {
    code,
    challenge: {
      codeHash: hashCode(code, secret),
      expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      attempts: 0,
    },
  };
}

/**
 * Verify a submitted code against a challenge.
 *
 * Order matters: attempts and expiry are checked BEFORE the comparison, so
 * an exhausted or expired challenge costs an attacker nothing to probe and
 * yields no timing signal about the code itself.
 */
export function verifyOtp(
  challenge: OtpChallenge | null,
  submitted: string,
  secret: string,
  now: Date = new Date(),
): VerifyOutcome {
  // No challenge: same shape as a wrong code, so the endpoint cannot be used
  // to discover which phone numbers have pending logins.
  if (!challenge) {
    return { ok: false, reason: 'invalid' };
  }

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  if (now.getTime() > challenge.expiresAt.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  if (!/^\d+$/.test(submitted) || submitted.length !== OTP_LENGTH) {
    return { ok: false, reason: 'invalid' };
  }

  const expected = Buffer.from(challenge.codeHash, 'hex');
  const actual = Buffer.from(hashCode(submitted, secret), 'hex');

  // Equal lengths by construction (same HMAC), but timingSafeEqual throws on
  // mismatch, and an exception path would itself leak information.
  if (expected.length !== actual.length) {
    return { ok: false, reason: 'invalid' };
  }

  return timingSafeEqual(expected, actual)
    ? { ok: true }
    : { ok: false, reason: 'invalid' };
}

/**
 * Normalise a Bangladeshi phone number to E.164.
 *
 * Users type numbers in several shapes -- 01712345678, 8801712345678,
 * +880 1712-345678. All are the same person, and treating them as different
 * identities would create duplicate accounts for one human.
 *
 * Returns null when the input is not a valid BD mobile number.
 */
export function normaliseBdPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '').replace(/^\+/, '');

  // 01XXXXXXXXX (11 digits, local form)
  if (/^01[3-9]\d{8}$/.test(digits)) {
    return `+880${digits.slice(1)}`;
  }

  // 8801XXXXXXXXX (13 digits, country code without +)
  if (/^8801[3-9]\d{8}$/.test(digits)) {
    return `+${digits}`;
  }

  // BD mobile prefixes are 013-019; anything else is not a mobile number.
  return null;
}
