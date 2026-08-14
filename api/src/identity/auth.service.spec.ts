/**
 * Auth service tests.
 *
 * Covers the parts the pure OTP tests cannot: rate limiting, delivery
 * through the notification outbox (so the mandatory-SMS guarantee applies to
 * login codes too), and single-use consumption.
 */

import { ConfigService } from '@nestjs/config';

import { TransactionContext, UnitOfWork } from '../common/database/unit-of-work';
import { NotificationPort, NotificationRequest } from '../common/ports/notification.port';
import { RateLimitDecision, RateLimiter } from '../common/rate-limit/rate-limiter';

import { AuthService } from './auth.service';
import { hashCode, OTP_TTL_SECONDS, OtpChallenge } from './domain/otp';
import { verifySessionToken } from '../common/auth/session-token';
import { OtpStore } from './otp.store';
import { UserRepository, UserRow } from './user.repository';

const OTP_SECRET = 'otp-secret';
const SESSION_SECRET = 'session-secret';
const USER_ID = '22222222-2222-4222-8222-000000000001';

class FakeUow implements UnitOfWork {
  async withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ query: async () => [] });
  }
}

class FakeLimiter implements RateLimiter {
  hits: string[] = [];
  constructor(private readonly allow = true) {}

  async hit(key: string): Promise<RateLimitDecision> {
    this.hits.push(key);
    return { allowed: this.allow, remaining: 0, resetSeconds: 900 };
  }
}

class RecordingNotifications implements NotificationPort {
  queued: NotificationRequest[] = [];
  async enqueue(_tx: TransactionContext, request: NotificationRequest) {
    this.queued.push(request);
  }
}

class FakeUsers extends UserRepository {
  constructor(private readonly user: UserRow | null = null) {
    super();
  }

  override async findByPhone() {
    return this.user;
  }

  override async findOrCreateByPhone() {
    return USER_ID;
  }
}

class FakeOtpStore extends OtpStore {
  saved: OtpChallenge | null = null;
  consumed = false;
  attemptsRecorded = 0;

  constructor(private readonly existing: OtpChallenge | null = null) {
    super(undefined as never);
  }

  override async save(_phone: string, challenge: OtpChallenge) {
    this.saved = challenge;
  }

  override async load() {
    return this.existing;
  }

  override async recordAttempt() {
    this.attemptsRecorded += 1;
  }

  override async consume() {
    this.consumed = true;
  }
}

const config = () =>
  ({
    get: (key: string) => {
      if (key === 'OTP_SECRET') return OTP_SECRET;
      if (key === 'SESSION_SECRET') return SESSION_SECRET;
      return undefined;
    },
  }) as ConfigService;

function harness(
  options: {
    allow?: boolean;
    existing?: OtpChallenge | null;
    user?: UserRow | null;
  } = {},
) {
  const limiter = new FakeLimiter(options.allow ?? true);
  const notifications = new RecordingNotifications();
  const store = new FakeOtpStore(options.existing ?? null);
  const users = new FakeUsers(
    options.user === undefined
      ? { id: USER_ID, phone_e164: '+8801712345678', language_preference: 'bn' }
      : options.user,
  );

  const service = new AuthService(
    new FakeUow(),
    limiter,
    notifications,
    users,
    store,
    config(),
  );

  return { service, limiter, notifications, store };
}

describe('AuthService.requestOtp', () => {
  it('sends a code for a valid BD number', async () => {
    const { service, notifications, store } = harness();

    const result = await service.requestOtp('01712345678');

    expect(result.status).toBe('sent');
    expect(store.saved).not.toBeNull();
    expect(notifications.queued).toHaveLength(1);
    expect(notifications.queued[0].event).toBe('otp');
  });

  it('delivers the code through the notification outbox', async () => {
    // Which means the mandatory-SMS guarantee (Section 8) covers login codes
    // exactly as it covers order events.
    const { service, notifications } = harness();

    await service.requestOtp('01712345678');

    expect(notifications.queued[0].params.code).toMatch(/^\d{6}$/);
  });

  it('never stores the plaintext code', async () => {
    const { service, notifications, store } = harness();

    await service.requestOtp('01712345678');
    const sent = notifications.queued[0].params.code;

    expect(store.saved?.codeHash).toBe(hashCode(sent, OTP_SECRET));
    expect(store.saved?.codeHash).not.toContain(sent);
  });

  it('rejects a non-BD number without sending anything', async () => {
    const { service, notifications } = harness();

    const result = await service.requestOtp('+919999999999');

    expect(result.status).toBe('invalid_phone');
    expect(notifications.queued).toEqual([]);
  });

  it('rate limits per phone number', async () => {
    // Every request costs an SMS, so this is both an anti-harassment and an
    // anti-bill-shock control.
    const { service, limiter, notifications } = harness({ allow: false });

    const result = await service.requestOtp('01712345678');

    expect(result.status).toBe('rate_limited');
    expect(limiter.hits[0]).toBe('otp:request:+8801712345678');
    expect(notifications.queued).toEqual([]);
  });

  it('normalises the number before rate limiting it', async () => {
    // Otherwise 01712345678 and +8801712345678 get separate buckets and the
    // limit is trivially bypassed.
    const { service, limiter } = harness();

    await service.requestOtp('+880 1712-345678');

    expect(limiter.hits[0]).toBe('otp:request:+8801712345678');
  });
});

describe('AuthService.verifyOtp', () => {
  const validChallenge = (code: string): OtpChallenge => ({
    codeHash: hashCode(code, OTP_SECRET),
    expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    attempts: 0,
  });

  it('returns a signed session token for the correct code', async () => {
    const { service } = harness({ existing: validChallenge('123456') });

    const result = await service.verifyOtp('01712345678', '123456');

    expect(result.status).toBe('authenticated');
    if (result.status === 'authenticated') {
      const verified = verifySessionToken(result.token, SESSION_SECRET);
      expect(verified.valid).toBe(true);
      expect(verified.valid && verified.payload.sub).toBe(USER_ID);
    }
  });

  it('consumes the code so it cannot be replayed', async () => {
    // An intercepted SMS must be useless once used.
    const { service, store } = harness({ existing: validChallenge('123456') });

    await service.verifyOtp('01712345678', '123456');

    expect(store.consumed).toBe(true);
  });

  it('records a failed attempt so the cap actually bites', async () => {
    const { service, store } = harness({ existing: validChallenge('123456') });

    await service.verifyOtp('01712345678', '999999');

    expect(store.attemptsRecorded).toBe(1);
    expect(store.consumed).toBe(false);
  });

  it('rejects when no challenge exists', async () => {
    const { service } = harness({ existing: null });

    const result = await service.verifyOtp('01712345678', '123456');

    expect(result).toEqual({ status: 'rejected', reason: 'invalid' });
  });

  it('rate limits verification separately from issuance', async () => {
    const { service, limiter } = harness({ allow: false });

    const result = await service.verifyOtp('01712345678', '123456');

    expect(result.status).toBe('rate_limited');
    expect(limiter.hits[0]).toBe('otp:verify:+8801712345678');
  });

  it('does not authenticate when the user record is missing', async () => {
    const { service } = harness({ existing: validChallenge('123456'), user: null });

    const result = await service.verifyOtp('01712345678', '123456');

    // Reported as invalid rather than a distinct error: saying "correct code,
    // no user" confirms the code was right.
    expect(result).toEqual({ status: 'rejected', reason: 'invalid' });
  });
});
