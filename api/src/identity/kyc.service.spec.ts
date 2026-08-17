/**
 * KYC submission — service-level tests.
 *
 * In-memory UserRepository fake, no database: proves the role-ownership
 * check, the already-verified guard, and NID shape validation without
 * touching Postgres.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';

import { TransactionContext, UnitOfWork } from '../common/database/unit-of-work';

import { KycService, SubmitKycCommand } from './kyc.service';
import { ActiveRole, UserRepository } from './user.repository';

const USER_ID = '22222222-2222-4222-8222-000000000001';
const MERCHANT_ROLE_ID = '33333333-3333-4333-8333-000000000003';
const OTHER_ROLE_ID = '33333333-3333-4333-8333-000000000009';

class FakeUow implements UnitOfWork {
  async withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ query: async () => [] });
  }
}

class FakeUsers extends UserRepository {
  submitted: Array<{
    userId: string;
    roleId: string;
    nidNumber: string;
    documentUrls: readonly string[];
  }> = [];

  constructor(private readonly roles: ActiveRole[]) {
    super();
  }

  override async findRoles() {
    return this.roles;
  }

  override async submitKyc(
    _tx: TransactionContext,
    userId: string,
    roleId: string,
    nidNumber: string,
    documentUrls: readonly string[],
  ) {
    this.submitted.push({ userId, roleId, nidNumber, documentUrls });
  }
}

const baseCommand = (overrides: Partial<SubmitKycCommand> = {}): SubmitKycCommand => ({
  userId: USER_ID,
  activeRoleId: MERCHANT_ROLE_ID,
  nidNumber: '1234567890',
  documentUrls: ['https://storage.example.com/nid-front.jpg'],
  ...overrides,
});

function buildService(roles: ActiveRole[]) {
  const users = new FakeUsers(roles);
  const service = new KycService(new FakeUow(), users);
  return { service, users };
}

const unverifiedMerchantRole: ActiveRole = {
  id: MERCHANT_ROLE_ID,
  type: 'merchant',
  kycVerified: false,
};

describe('KycService.submit', () => {
  it('records the submission and returns pending', async () => {
    const { service, users } = buildService([unverifiedMerchantRole]);

    const result = await service.submit(baseCommand());

    expect(result).toEqual({ status: 'pending' });
    expect(users.submitted).toEqual([
      {
        userId: USER_ID,
        roleId: MERCHANT_ROLE_ID,
        nidNumber: '1234567890',
        documentUrls: ['https://storage.example.com/nid-front.jpg'],
      },
    ]);
  });

  it('normalises the NID number before storing it', async () => {
    const { service, users } = buildService([unverifiedMerchantRole]);

    await service.submit(baseCommand({ nidNumber: '1234 5678-90' }));

    expect(users.submitted[0].nidNumber).toBe('1234567890');
  });

  it('rejects when no active role is set', async () => {
    const { service } = buildService([unverifiedMerchantRole]);

    await expect(service.submit(baseCommand({ activeRoleId: null }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a malformed NID number', async () => {
    const { service } = buildService([unverifiedMerchantRole]);

    await expect(service.submit(baseCommand({ nidNumber: 'not-a-nid' }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a role the caller does not hold', async () => {
    const { service } = buildService([unverifiedMerchantRole]);

    await expect(
      service.submit(baseCommand({ activeRoleId: OTHER_ROLE_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects resubmission for an already-verified role', async () => {
    const { service } = buildService([{ ...unverifiedMerchantRole, kycVerified: true }]);

    await expect(service.submit(baseCommand())).rejects.toThrow(ConflictException);
  });
});
