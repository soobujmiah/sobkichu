/**
 * Merchant onboarding — registers the merchant Role.
 *
 * Deliberately narrow: this creates the Role so a user can switch into it
 * (auth.service.ts) and, later, submit NID KYC. It does not itself verify
 * anything -- CatalogService and OrderService are what gate publishing and
 * transacting on `kyc_status`.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';

import { UNIT_OF_WORK, UnitOfWork } from '../common/database/unit-of-work';

import { UserRepository } from './user.repository';

export interface CreateMerchantCommand {
  readonly userId: string;
  readonly pickupLocationId: string;
  readonly businessNameBn: string;
  readonly businessNameEn?: string;
}

export interface CreatedMerchant {
  readonly roleId: string;
}

/** Postgres foreign-key-violation SQLSTATE. */
const FOREIGN_KEY_VIOLATION = '23503';

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION
  );
}

@Injectable()
export class MerchantOnboardingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
  ) {}

  async createMerchant(command: CreateMerchantCommand): Promise<CreatedMerchant> {
    const profile: Record<string, unknown> = {
      businessNameBn: command.businessNameBn,
      businessNameEn: command.businessNameEn ?? null,
    };

    let created: { id: string } | null;

    try {
      created = await this.uow.withTransaction((tx) =>
        this.users.createMerchantRole(
          tx,
          command.userId,
          command.pickupLocationId,
          profile,
        ),
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new BadRequestException('error.merchant.pickup_location_not_found');
      }
      throw error;
    }

    if (!created) {
      // UNIQUE (user_id, type): this user already has a merchant role.
      throw new ConflictException('error.merchant.already_registered');
    }

    return { roleId: created.id };
  }
}
