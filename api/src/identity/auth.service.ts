/**
 * Phone-based OTP authentication.
 *
 * Two steps: request a code by phone, then exchange the code for a session
 * token. Phone is the identifier because that is the BD reality -- email is
 * not the default (canonical data model).
 *
 * The OTP is delivered through the notification outbox, so the mandatory-SMS
 * guarantee applies to login codes exactly as it does to order events
 * (master prompt Section 8).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UNIT_OF_WORK, UnitOfWork } from '../common/database/unit-of-work';
import { NOTIFICATION_PORT, NotificationPort } from '../common/ports/notification.port';
import {
  RATE_LIMITER,
  RATE_LIMITS,
  RateLimiter,
} from '../common/rate-limit/rate-limiter';

import { issueOtp, normaliseBdPhone, verifyOtp } from './domain/otp';
import { issueSessionToken } from '../common/auth/session-token';
import { OtpStore } from './otp.store';
import { ActiveRole, UserRepository } from './user.repository';

export type RequestOtpResult =
  | { status: 'sent'; retryAfterSeconds: number }
  | { status: 'invalid_phone' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type VerifyOtpResult =
  | { status: 'authenticated'; token: string; userId: string }
  | { status: 'rejected'; reason: 'invalid' | 'expired' | 'too_many_attempts' }
  | { status: 'invalid_phone' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type SwitchRoleResult =
  | { status: 'switched'; token: string; roleType: string }
  /** Covers "doesn't exist", "belongs to another user" and "inactive" alike
   *  -- distinguishing them would tell a caller which role ids exist. */
  | { status: 'role_not_found' };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
    private readonly users: UserRepository,
    private readonly otps: OtpStore,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issue a login code.
   *
   * Rate limited per phone number: every call sends an SMS, so an
   * unthrottled endpoint is both a harassment vector and a way to run up a
   * gateway bill.
   */
  async requestOtp(rawPhone: string): Promise<RequestOtpResult> {
    const phone = normaliseBdPhone(rawPhone);
    if (!phone) {
      return { status: 'invalid_phone' };
    }

    const policy = RATE_LIMITS.otpRequest;
    const decision = await this.rateLimiter.hit(
      `otp:request:${phone}`,
      policy.limit,
      policy.windowSeconds,
    );

    if (!decision.allowed) {
      return { status: 'rate_limited', retryAfterSeconds: decision.resetSeconds };
    }

    const secret = this.otpSecret();
    const { code, challenge } = issueOtp(secret);

    await this.otps.save(phone, challenge);

    // Create the user on first login. BD onboarding should not require a
    // separate registration step before a code can be sent.
    const userId = await this.uow.withTransaction(async (tx) => {
      const id = await this.users.findOrCreateByPhone(tx, phone);

      await this.notifications.enqueue(tx, {
        userId: id,
        event: 'otp',
        params: { code },
        // Time-bucketed: a genuine re-request after the window must produce
        // a new SMS, but a double-tap within seconds must not.
        dedupeKey: `otp:${phone}:${Math.floor(Date.now() / 60_000)}`,
      });

      return id;
    });

    this.logger.log(`OTP issued for user ${userId}`);

    return { status: 'sent', retryAfterSeconds: decision.resetSeconds };
  }

  /**
   * Exchange a code for a session token.
   *
   * Rate limited separately from issuance: MAX_VERIFY_ATTEMPTS caps guesses
   * against one challenge, and this caps how many challenges an attacker can
   * churn through.
   */
  async verifyOtp(rawPhone: string, code: string): Promise<VerifyOtpResult> {
    const phone = normaliseBdPhone(rawPhone);
    if (!phone) {
      return { status: 'invalid_phone' };
    }

    const policy = RATE_LIMITS.otpVerify;
    const decision = await this.rateLimiter.hit(
      `otp:verify:${phone}`,
      policy.limit,
      policy.windowSeconds,
    );

    if (!decision.allowed) {
      return { status: 'rate_limited', retryAfterSeconds: decision.resetSeconds };
    }

    const challenge = await this.otps.load(phone);
    const outcome = verifyOtp(challenge, code, this.otpSecret());

    if (!outcome.ok) {
      // Record the failed attempt so MAX_VERIFY_ATTEMPTS actually bites.
      if (challenge) {
        await this.otps.recordAttempt(phone, challenge);
      }
      return { status: 'rejected', reason: outcome.reason };
    }

    // Single use: consume before minting the token so an intercepted SMS
    // cannot be replayed.
    await this.otps.consume(phone);

    const user = await this.uow.withTransaction((tx) =>
      this.users.findByPhone(tx, phone),
    );

    if (!user) {
      // Challenge verified but the user vanished: treat as invalid rather
      // than leaking that the code itself was correct.
      return { status: 'rejected', reason: 'invalid' };
    }

    const token = issueSessionToken(user.id, null, this.sessionSecret());

    return { status: 'authenticated', token, userId: user.id };
  }

  /** Roles the caller can switch into -- for a client-side role switcher. */
  async listRoles(userId: string): Promise<ActiveRole[]> {
    return this.uow.withTransaction((tx) => this.users.findRoles(tx, userId));
  }

  /**
   * Re-issue the session token with a different active role.
   *
   * The role must belong to the caller and be active -- `findRoles` already
   * filters on both (WHERE user_id = $1 AND is_active), so anything not in
   * that list is treated as not found, deliberately not distinguished from
   * "doesn't exist" (see SwitchRoleResult).
   *
   * KYC state is NOT checked here. It never travels in the token (see
   * session-token.ts) and is re-read per request by whichever endpoint the
   * caller hits next -- an unverified merchant can switch into the merchant
   * role, they just cannot publish or transact until KYC clears.
   */
  async switchRole(userId: string, roleId: string): Promise<SwitchRoleResult> {
    const roles = await this.uow.withTransaction((tx) =>
      this.users.findRoles(tx, userId),
    );
    const role = roles.find((candidate) => candidate.id === roleId);

    if (!role) {
      return { status: 'role_not_found' };
    }

    const token = issueSessionToken(userId, role.id, this.sessionSecret());

    return { status: 'switched', token, roleType: role.type };
  }

  private otpSecret(): string {
    const secret = this.config.get<string>('OTP_SECRET');
    if (!secret) {
      throw new Error('OTP_SECRET is not configured');
    }
    return secret;
  }

  private sessionSecret(): string {
    const secret = this.config.get<string>('SESSION_SECRET');
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured');
    }
    return secret;
  }
}
