/**
 * Session token tests.
 *
 * A forged token is an authentication bypass, so these cover the tampering
 * cases explicitly rather than only the happy path.
 */

import {
  issueSessionToken,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from './session-token';

const SECRET = 'test-session-secret';
const USER = '22222222-2222-4222-8222-000000000001';

describe('session tokens', () => {
  const now = new Date('2026-08-14T10:00:00Z');

  it('round-trips a user id and active role', () => {
    const token = issueSessionToken(USER, 'role-1', SECRET, now);
    const result = verifySessionToken(token, SECRET, now);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe(USER);
      expect(result.payload.activeRoleId).toBe('role-1');
    }
  });

  it('supports a session with no active role selected', () => {
    const token = issueSessionToken(USER, null, SECRET, now);
    const result = verifySessionToken(token, SECRET, now);

    expect(result.valid && result.payload.activeRoleId).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueSessionToken(USER, null, 'attacker-secret', now);

    expect(verifySessionToken(token, SECRET, now)).toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered payload', () => {
    // The attack this prevents: swap `sub` for another user's id.
    const token = issueSessionToken(USER, null, SECRET, now);
    const [, signature] = token.split('.');

    const forged = Buffer.from(
      JSON.stringify({
        sub: 'someone-else',
        activeRoleId: null,
        iat: 0,
        exp: 9999999999,
      }),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(verifySessionToken(`${forged}.${signature}`, SECRET, now)).toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired token', () => {
    const token = issueSessionToken(USER, null, SECRET, now);
    const after = new Date(now.getTime() + (SESSION_TTL_SECONDS + 1) * 1000);

    expect(verifySessionToken(token, SECRET, after)).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('is still valid just before expiry', () => {
    const token = issueSessionToken(USER, null, SECRET, now);
    const justBefore = new Date(now.getTime() + (SESSION_TTL_SECONDS - 1) * 1000);

    expect(verifySessionToken(token, SECRET, justBefore).valid).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['garbage', 'no separator'],
    ['a.b.c', 'too many parts'],
    ['.signature', 'empty payload'],
    ['payload.', 'empty signature'],
  ])('rejects a malformed token: %s (%s)', (token) => {
    const result = verifySessionToken(token, SECRET, now);

    expect(result.valid).toBe(false);
  });

  it('does not throw on non-base64 payloads', () => {
    expect(() => verifySessionToken('!!!.???', SECRET, now)).not.toThrow();
  });

  it('refuses to issue or verify without a secret, rather than failing open', () => {
    expect(() => issueSessionToken(USER, null, '', now)).toThrow();
    expect(() => verifySessionToken('a.b', '', now)).toThrow();
  });
});
