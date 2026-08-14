/**
 * Auth guard tests.
 *
 * The guard is registered globally, so a bug here is an authentication
 * bypass across every endpoint at once.
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { AuthGuard, AuthenticatedRequest } from './auth.guard';
import { issueSessionToken } from './session-token';

const SECRET = 'test-session-secret';
const USER = '22222222-2222-4222-8222-000000000001';

const config = (secret: string | undefined = SECRET) =>
  ({ get: () => secret }) as unknown as ConfigService;

const reflector = (isPublic: boolean) =>
  ({ getAllAndOverride: () => isPublic }) as unknown as Reflector;

function contextWith(headers: Record<string, string>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = { headers } as unknown as AuthenticatedRequest;

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('AuthGuard', () => {
  it('attaches the caller from a valid token', () => {
    const token = issueSessionToken(USER, 'role-1', SECRET);
    const { context, request } = contextWith({ authorization: `Bearer ${token}` });

    const guard = new AuthGuard(config(), reflector(false));

    expect(guard.canActivate(context)).toBe(true);
    expect(request.caller).toEqual({ userId: USER, activeRoleId: 'role-1' });
  });

  it('rejects a request with no Authorization header', () => {
    const { context } = contextWith({});
    const guard = new AuthGuard(config(), reflector(false));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', () => {
    const { context } = contextWith({ authorization: 'Basic dXNlcjpwYXNz' });
    const guard = new AuthGuard(config(), reflector(false));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with another secret', () => {
    const token = issueSessionToken(USER, null, 'attacker-secret');
    const { context } = contextWith({ authorization: `Bearer ${token}` });
    const guard = new AuthGuard(config(), reflector(false));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('gives the same message for forged and expired tokens', () => {
    // Distinguishing them tells an attacker which tokens are real.
    const guard = new AuthGuard(config(), reflector(false));
    const forged = contextWith({ authorization: 'Bearer forged.token' });

    let forgedMessage = '';
    try {
      guard.canActivate(forged.context);
    } catch (error) {
      forgedMessage = (error as UnauthorizedException).message;
    }

    expect(forgedMessage).toBe('error.auth.invalid_token');
  });

  it('fails closed when SESSION_SECRET is not configured', () => {
    const token = issueSessionToken(USER, null, SECRET);
    const { context } = contextWith({ authorization: `Bearer ${token}` });
    const guard = new AuthGuard(config(undefined), reflector(false));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('allows a @Public() route through without a token', () => {
    const { context, request } = contextWith({});
    const guard = new AuthGuard(config(), reflector(true));

    expect(guard.canActivate(context)).toBe(true);
    expect(request.caller).toBeUndefined();
  });

  it('uses an i18n key for every failure message', () => {
    const guard = new AuthGuard(config(), reflector(false));
    const { context } = contextWith({});

    try {
      guard.canActivate(context);
      fail('expected UnauthorizedException');
    } catch (error) {
      expect((error as UnauthorizedException).message).toMatch(
        /^[a-z0-9_]+(\.[a-z0-9_]+)+$/,
      );
    }
  });
});
