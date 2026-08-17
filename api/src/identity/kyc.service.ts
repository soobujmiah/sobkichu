/**
 * NID KYC submission.
 *
 * Phase 1 DoD (docs/roadmap.md): "Merchant: NID KYC before publishing".
 * Compliance row K1 (docs/compliance/compliance-matrix.md): merchants
 * cannot publish listings until `role.kyc_status` is 'verified'.
 *
 * This is the SUBMISSION half only. It moves state to 'pending', never
 * 'verified' -- there is no automated register check (no vendor named yet,
 * MASTER_PROMPT.md) and no admin review path built (Central Admin Panel is
 * separate, not-yet-built work, CURRENT_STATE.md). CatalogService's K1 gate
 * is unaffected by this file; an unverified merchant still cannot publish
 * after submitting.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';

import { UNIT_OF_WORK, UnitOfWork } from '../common/database/unit-of-work';

import { normaliseNidNumber } from './domain/nid';
import { UserRepository } from './user.repository';

export interface SubmitKycCommand {
  readonly userId: string;
  /** The caller's active role id -- never trusted from the request body. */
  readonly activeRoleId: string | null;
  readonly nidNumber: string;
  readonly documentUrls: readonly string[];
}

export interface SubmittedKyc {
  readonly status: 'pending';
}

@Injectable()
export class KycService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
  ) {}

  async submit(command: SubmitKycCommand): Promise<SubmittedKyc> {
    // Same precondition as listing creation: KYC is submitted for a role
    // the caller is actively acting as, not any role they happen to hold.
    const activeRoleId = command.activeRoleId;
    if (!activeRoleId) {
      throw new BadRequestException('error.kyc.no_active_role');
    }

    const nidNumber = normaliseNidNumber(command.nidNumber);
    if (!nidNumber) {
      // Shape validation only -- there is no register to check the number
      // against yet (see the file header). Garbage input is still rejected.
      throw new BadRequestException('error.kyc.invalid_nid_format');
    }

    await this.uow.withTransaction(async (tx) => {
      // findRoles filters WHERE user_id = $1 AND is_active -- "doesn't
      // exist", "belongs to someone else" and "inactive" all collapse to
      // role_not_found, same reasoning as AuthService.switchRole.
      const roles = await this.users.findRoles(tx, command.userId);
      const role = roles.find((candidate) => candidate.id === activeRoleId);

      if (!role) {
        throw new BadRequestException('error.kyc.role_not_found');
      }
      if (role.kycVerified) {
        // Nothing to do -- resubmitting a verified role would move it back
        // to 'pending', which reads as a regression to anything watching
        // kyc_status, not a no-op.
        throw new ConflictException('error.kyc.already_verified');
      }

      await this.users.submitKyc(
        tx,
        command.userId,
        role.id,
        nidNumber,
        command.documentUrls,
      );
    });

    return { status: 'pending' };
  }
}
