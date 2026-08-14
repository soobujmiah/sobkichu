/**
 * Injects the authenticated caller into a handler parameter.
 *
 * Replaces reading a user id from the request body, which would let any
 * client place orders as any user.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedCaller, AuthenticatedRequest } from './auth.guard';

export const Caller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedCaller => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.caller) {
      // Unreachable when the guard is registered globally; throwing rather
      // than returning a fake id means a misconfiguration fails loudly.
      throw new Error('Caller requested on a route with no auth guard');
    }

    return request.caller;
  },
);
