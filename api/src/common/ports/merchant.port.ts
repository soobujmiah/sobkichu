/**
 * Identity port — merchant/role facts that `order` needs but must not read
 * from the `role` table itself.
 *
 * `identity` owns `app_user`, `role` and `user_saved_location`.
 */

export const MERCHANT_PORT = Symbol('MERCHANT_PORT');

export interface MerchantSummary {
  readonly roleId: string;
  /**
   * NID-based KYC state. A merchant may not publish listings or receive
   * orders until this is `verified` (compliance row K1).
   */
  readonly kycVerified: boolean;
  readonly isActive: boolean;
  /** Pickup Location id — the origin for same-city determination. */
  readonly pickupLocationId: string | null;
}

export interface MerchantPort {
  /** Throws when the role id is unknown or is not a merchant role. */
  findMerchant(roleId: string): Promise<MerchantSummary>;
}
