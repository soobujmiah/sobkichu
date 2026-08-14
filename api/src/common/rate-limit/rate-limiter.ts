/**
 * Rate limiting.
 *
 * Required on OTP issuance, login, and order creation
 * (docs/architecture/backend-modules.md, cross-cutting concerns).
 *
 * OTP issuance is the one that costs real money if unbounded: every request
 * sends an SMS, so an unthrottled endpoint is both an account-harassment
 * vector and a way to run up a gateway bill.
 *
 * The interface is kept free of Redis specifics so the limiter can be
 * swapped or faked in tests. The Redis implementation lives alongside.
 */

export const RATE_LIMITER = Symbol('RATE_LIMITER');

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Requests left in the current window. */
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly resetSeconds: number;
}

export interface RateLimiter {
  /**
   * Count one hit against `key` and report whether it is allowed.
   *
   * Fixed-window: simple, and adequate at Phase 1 scale. A sliding window
   * would be more precise at the boundary but is not worth the complexity
   * for tens of thousands of DAU (master prompt Section 8: do not
   * over-engineer for a scale that does not exist).
   */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
}

/** Policies, named so call sites read as intent rather than magic numbers. */
export const RATE_LIMITS = {
  /** Per phone number. Each hit sends an SMS and costs money. */
  otpRequest: { limit: 3, windowSeconds: 15 * 60 },
  /** Per phone number. Brute force is separately capped by MAX_VERIFY_ATTEMPTS. */
  otpVerify: { limit: 10, windowSeconds: 15 * 60 },
  /** Per user. Generous: a real customer may legitimately order repeatedly. */
  orderCreate: { limit: 20, windowSeconds: 60 * 60 },
} as const;
