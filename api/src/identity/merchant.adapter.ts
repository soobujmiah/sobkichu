/**
 * Identity adapter — implements MerchantPort.
 *
 * `identity` owns `app_user`, `role` and `user_saved_location`.
 *
 * The KYC translation here is the compliance-bearing part: `role.kyc_status`
 * is an enum with four values, and only 'verified' permits a merchant to
 * transact (compliance row K1). Collapsing it to a boolean AT THIS BOUNDARY
 * means a future enum value cannot accidentally read as verified downstream.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '../common/database/pg.provider';
import { MerchantPort, MerchantSummary } from '../common/ports/merchant.port';

interface RoleRow {
  id: string;
  kyc_status: string;
  is_active: boolean;
  pickup_location_id: string | null;
}

@Injectable()
export class MerchantAdapter implements MerchantPort {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findMerchant(roleId: string): Promise<MerchantSummary> {
    const result = await this.pool.query<RoleRow>(
      `SELECT id, kyc_status, is_active, pickup_location_id
         FROM role
        WHERE id = $1
          AND type = 'merchant'`,
      [roleId],
    );

    const row = result.rows[0];

    if (!row) {
      // Also covers "this role id exists but is not a merchant role".
      throw new NotFoundException('error.checkout.merchant_not_found');
    }

    return {
      roleId: row.id,
      // Allowlist, not a denylist: anything that is not exactly 'verified'
      // is unverified. 'pending' and 'rejected' both block transacting.
      kycVerified: row.kyc_status === 'verified',
      isActive: row.is_active,
      pickupLocationId: row.pickup_location_id,
    };
  }
}
