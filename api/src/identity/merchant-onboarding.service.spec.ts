/**
 * Merchant onboarding — service-level tests.
 *
 * No database: TransactionContext is a stub, UserRepository is an in-memory
 * fake that can simulate both outcomes a real INSERT can produce -- a
 * conflict (already registered) and a foreign-key violation (unknown
 * pickup location) -- without a real Postgres connection.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';

import { TransactionContext, UnitOfWork } from '../common/database/unit-of-work';

import {
  CreateMerchantCommand,
  MerchantOnboardingService,
} from './merchant-onboarding.service';
import { UserRepository } from './user.repository';

const USER_ID = '22222222-2222-4222-8222-000000000001';
const LOCATION_ID = '11111111-1111-4111-8111-000000000001';

class FakeUow implements UnitOfWork {
  async withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ query: async () => [] });
  }
}

class ForeignKeyViolation extends Error {
  code = '23503';
}

type Outcome = { id: string } | null | 'fk_violation';

class FakeUsers extends UserRepository {
  calls: Array<{
    userId: string;
    pickupLocationId: string;
    profile: Record<string, unknown>;
  }> = [];

  constructor(private readonly outcome: Outcome) {
    super();
  }

  override async createMerchantRole(
    _tx: TransactionContext,
    userId: string,
    pickupLocationId: string,
    profile: Record<string, unknown>,
  ) {
    this.calls.push({ userId, pickupLocationId, profile });

    const outcome = this.outcome;
    if (outcome === 'fk_violation') {
      throw new ForeignKeyViolation('insert or update on table "role" violates FK');
    }

    return outcome;
  }
}

const baseCommand = (
  overrides: Partial<CreateMerchantCommand> = {},
): CreateMerchantCommand => ({
  userId: USER_ID,
  pickupLocationId: LOCATION_ID,
  businessNameBn: 'দোকানের নাম',
  ...overrides,
});

function buildService(outcome: Outcome) {
  const users = new FakeUsers(outcome);
  const service = new MerchantOnboardingService(new FakeUow(), users);
  return { service, users };
}

describe('MerchantOnboardingService.createMerchant', () => {
  it('creates the role and returns its id', async () => {
    const { service, users } = buildService({ id: 'role-1' });

    const result = await service.createMerchant(baseCommand());

    expect(result).toEqual({ roleId: 'role-1' });
    expect(users.calls).toHaveLength(1);
    expect(users.calls[0]).toEqual({
      userId: USER_ID,
      pickupLocationId: LOCATION_ID,
      profile: { businessNameBn: 'দোকানের নাম', businessNameEn: null },
    });
  });

  it('carries an optional English business name into the profile', async () => {
    const { service, users } = buildService({ id: 'role-1' });

    await service.createMerchant(baseCommand({ businessNameEn: 'Shop Name' }));

    expect(users.calls[0].profile.businessNameEn).toBe('Shop Name');
  });

  it('rejects when the user already has a merchant role', async () => {
    // ON CONFLICT DO NOTHING -- the repository returns null, not a row.
    const { service } = buildService(null);

    await expect(service.createMerchant(baseCommand())).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects an unknown pickup location as a client error, not a 500', async () => {
    const { service } = buildService('fk_violation');

    await expect(service.createMerchant(baseCommand())).rejects.toThrow(
      BadRequestException,
    );
  });
});
