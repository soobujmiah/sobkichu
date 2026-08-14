/**
 * Session guard.
 *
 * Reads the bearer token, verifies its signature, and attaches the caller to
 * the request. Role claims are NEVER read from the request body -- that is
 * the whole point (docs/architecture/backend-modules.md, cross-cutting
 * concerns).
 *
 * The token carries a user id and an active role id, nothing else. KYC state
 * and permissions are read from the database per request, so a token minted
 * before a merchant's KYC was revoked cannot keep asserting they are
 * verified.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { verifySessionToken } from './domain/session-token';
import { IS_PUBLIC } from './public.decorator';

export interface AuthenticatedCaller {
  readonly userId: string;
  readonly activeRoleId: string | null;
}

/** Request augmented with the verified caller. */
export interface AuthenticatedRequest extends Request {
  caller?: AuthenticatedCaller;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Opt-out is explicit and per-route. Registered globally so a new
    // endpoint is protected by default rather than by remembering to add a
    // guard -- the failure mode of opt-in auth is a forgotten decorator on
    // an endpoint that moves money.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('error.auth.missing_token');
    }

    const secret = this.config.get<string>('SESSION_SECRET');
    if (!secret) {
      // Deployment error. Fail closed rather than accepting anything.
      throw new UnauthorizedException('error.auth.not_configured');
    }

    const result = verifySessionToken(header.slice('Bearer '.length), secret);

    if (!result.valid) {
      // Uniform message: distinguishing "expired" from "forged" tells an
      // attacker which tokens are real.
      throw new UnauthorizedException('error.auth.invalid_token');
    }

    request.caller = {
      userId: result.payload.sub,
      activeRoleId: result.payload.activeRoleId,
    };

    return true;
  }
}
