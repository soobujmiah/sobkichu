/**
 * User repository.
 *
 * `identity` owns app_user, role and user_saved_location.
 */

import { Injectable } from '@nestjs/common';

import { TransactionContext } from '../common/database/unit-of-work';

export interface UserRow {
  id: string;
  phone_e164: string;
  language_preference: string;
}

export interface ActiveRole {
  readonly id: string;
  readonly type: string;
  readonly kycVerified: boolean;
}

@Injectable()
export class UserRepository {
  async findByPhone(
    tx: TransactionContext,
    phoneE164: string,
  ): Promise<UserRow | null> {
    const rows = await tx.query<UserRow>(
      'SELECT id, phone_e164, language_preference FROM app_user WHERE phone_e164 = $1',
      [phoneE164],
    );

    return rows[0] ?? null;
  }

  /**
   * Find or create by phone.
   *
   * ON CONFLICT rather than a check-then-insert: two concurrent first-time
   * logins from the same number would otherwise race and one would fail on
   * the UNIQUE constraint.
   *
   * New users default to Bangla (language_preference defaults to 'bn' in the
   * schema) -- Bangla-first is structural, not a setting to opt into.
   */
  async findOrCreateByPhone(
    tx: TransactionContext,
    phoneE164: string,
  ): Promise<string> {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO app_user (phone_e164)
       VALUES ($1)
       ON CONFLICT (phone_e164) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [phoneE164],
    );

    return rows[0].id;
  }

  /** Roles this user holds, for role switching. */
  async findRoles(tx: TransactionContext, userId: string): Promise<ActiveRole[]> {
    const rows = await tx.query<{ id: string; type: string; kyc_status: string }>(
      'SELECT id, type, kyc_status FROM role WHERE user_id = $1 AND is_active',
      [userId],
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      kycVerified: row.kyc_status === 'verified',
    }));
  }
}
