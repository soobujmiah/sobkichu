/**
 * User repository.
 *
 * `identity` owns app_user, role, user_saved_location and kyc_submission.
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
  async findByPhone(tx: TransactionContext, phoneE164: string): Promise<UserRow | null> {
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
  async findOrCreateByPhone(tx: TransactionContext, phoneE164: string): Promise<string> {
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

  /**
   * Register the merchant Role for a user.
   *
   * `ON CONFLICT ... DO NOTHING` rather than check-then-insert, same
   * reasoning as `findOrCreateByPhone`: two concurrent onboarding submits
   * would otherwise race. `role.type` has one merchant row per user (schema
   * UNIQUE (user_id, type)), so a conflict here means "already a merchant",
   * not a retry-safe no-op -- the caller distinguishes null from a row.
   *
   * Does not validate `pickupLocationId` itself; the `location` foreign key
   * does, and a violation propagates as a plain pg error (code 23503) for
   * the caller to translate.
   */
  async createMerchantRole(
    tx: TransactionContext,
    userId: string,
    pickupLocationId: string,
    profile: Record<string, unknown>,
  ): Promise<{ id: string } | null> {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO role (user_id, type, profile, pickup_location_id)
       VALUES ($1, 'merchant', $2::jsonb, $3)
       ON CONFLICT (user_id, type) DO NOTHING
       RETURNING id`,
      [userId, JSON.stringify(profile), pickupLocationId],
    );

    return rows[0] ?? null;
  }

  /**
   * Record a KYC submission.
   *
   * Three writes, one transaction: the NID number lands on `app_user`
   * (person-level -- one NID per human, regardless of how many roles they
   * hold), `kyc_status` moves to 'pending' on the specific `role` being
   * verified, and the submission itself is appended to `kyc_submission` as
   * an audit record (migration 002) -- a resubmission after rejection must
   * not destroy the record of the earlier attempt.
   *
   * Does not decide whether to allow the submission (role ownership,
   * already-verified) -- that is KycService's job. This method only writes.
   */
  async submitKyc(
    tx: TransactionContext,
    userId: string,
    roleId: string,
    nidNumber: string,
    documentUrls: readonly string[],
  ): Promise<void> {
    await tx.query(
      `UPDATE app_user
          SET nid_number = $1, nid_verification_status = 'pending', updated_at = now()
        WHERE id = $2`,
      [nidNumber, userId],
    );

    await tx.query(`UPDATE role SET kyc_status = 'pending' WHERE id = $1`, [roleId]);

    await tx.query(
      `INSERT INTO kyc_submission (role_id, document_urls) VALUES ($1, $2)`,
      [roleId, documentUrls as string[]],
    );
  }
}
