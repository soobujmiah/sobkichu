/**
 * OTP security tests.
 *
 * These guard the login path. Each test corresponds to a specific way this
 * goes wrong in production, named in the test so a future reader knows what
 * they would be re-introducing by deleting it.
 */

import {
  generateCode,
  hashCode,
  issueOtp,
  MAX_VERIFY_ATTEMPTS,
  normaliseBdPhone,
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  OtpChallenge,
  verifyOtp,
} from './otp';

const SECRET = 'test-otp-secret';

describe('OTP generation', () => {
  it('produces a code of the expected length', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it('preserves leading zeros', () => {
    // Naive Number-based generation drops them, shortening the code and
    // shrinking the keyspace.
    const codes = Array.from({ length: 2000 }, () => generateCode());

    expect(codes.every((c) => c.length === OTP_LENGTH)).toBe(true);
    // With 2000 draws, seeing at least one code starting 0 is near certain.
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });

  it('does not repeat predictably', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode()));

    // Birthday collisions are expected in a million-wide space; a broken
    // generator would collapse to a handful of values.
    expect(codes.size).toBeGreaterThan(450);
  });
});

describe('OTP hashing', () => {
  it('never stores the plaintext code', () => {
    const { code, challenge } = issueOtp(SECRET);

    expect(challenge.codeHash).not.toContain(code);
    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash under a different secret', () => {
    // A bare SHA-256 of a 6-digit code is reversible by hashing all million
    // candidates; the secret is what makes a stolen hash useless.
    expect(hashCode('123456', 'secret-a')).not.toBe(hashCode('123456', 'secret-b'));
  });

  it('refuses to hash without a secret rather than hashing weakly', () => {
    expect(() => hashCode('123456', '')).toThrow();
  });
});

describe('OTP verification', () => {
  const now = new Date('2026-08-14T10:00:00Z');

  function challengeFor(code: string, overrides: Partial<OtpChallenge> = {}) {
    return {
      codeHash: hashCode(code, SECRET),
      expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      attempts: 0,
      ...overrides,
    };
  }

  it('accepts the correct code', () => {
    expect(verifyOtp(challengeFor('123456'), '123456', SECRET, now)).toEqual({
      ok: true,
    });
  });

  it('rejects a wrong code', () => {
    expect(verifyOtp(challengeFor('123456'), '999999', SECRET, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects an expired code', () => {
    const later = new Date(now.getTime() + (OTP_TTL_SECONDS + 1) * 1000);

    expect(verifyOtp(challengeFor('123456'), '123456', SECRET, later)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects once attempts are exhausted', () => {
    // 6 digits is a million combinations; without a cap, brute force is
    // trivial.
    const exhausted = challengeFor('123456', { attempts: MAX_VERIFY_ATTEMPTS });

    expect(verifyOtp(exhausted, '123456', SECRET, now)).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  it('checks attempts BEFORE comparing, so an exhausted code leaks nothing', () => {
    const exhausted = challengeFor('123456', { attempts: MAX_VERIFY_ATTEMPTS });

    // Correct and incorrect codes must be indistinguishable once exhausted.
    expect(verifyOtp(exhausted, '123456', SECRET, now)).toEqual(
      verifyOtp(exhausted, '000000', SECRET, now),
    );
  });

  it('returns the same shape when no challenge exists', () => {
    // Otherwise the endpoint becomes a phone-number enumeration oracle.
    expect(verifyOtp(null, '123456', SECRET, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects malformed submissions without throwing', () => {
    for (const bad of ['', 'abcdef', '12345', '1234567', '12 34 56']) {
      expect(verifyOtp(challengeFor('123456'), bad, SECRET, now)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('rejects a code verified against the wrong secret', () => {
    expect(verifyOtp(challengeFor('123456'), '123456', 'other-secret', now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('BD phone normalisation', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['+880 1712-345678', '+8801712345678'],
    ['01912345678', '+8801912345678'],
    ['01312345678', '+8801312345678'],
  ])('normalises %s', (input, expected) => {
    // All of these are one human. Treating them as separate identities
    // creates duplicate accounts.
    expect(normaliseBdPhone(input)).toBe(expected);
  });

  it.each([
    ['01212345678', 'operator prefix 012 is not a BD mobile'],
    ['0171234567', 'too short'],
    ['017123456789', 'too long'],
    ['+911712345678', 'wrong country'],
    ['not-a-number', 'not numeric'],
    ['', 'empty'],
  ])('rejects %s (%s)', (input) => {
    expect(normaliseBdPhone(input)).toBeNull();
  });

  it('maps every valid BD mobile prefix', () => {
    for (const prefix of ['013', '014', '015', '016', '017', '018', '019']) {
      const expected = `+880${prefix.slice(1)}12345678`;
      expect(normaliseBdPhone(`${prefix}12345678`)).toBe(expected);
    }
  });
});
