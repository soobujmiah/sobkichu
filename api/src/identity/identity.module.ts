/**
 * Identity module. Owns `app_user`, `role`, `user_saved_location`.
 *
 * Phase 1 exposes only the merchant lookup that `order` needs. Auth, OTP and
 * NID KYC submission land here too.
 */

import { Module } from '@nestjs/common';

import { MERCHANT_PORT } from '../common/ports/merchant.port';

import { MerchantAdapter } from './merchant.adapter';

@Module({
  providers: [MerchantAdapter, { provide: MERCHANT_PORT, useExisting: MerchantAdapter }],
  exports: [MERCHANT_PORT],
})
export class IdentityModule {}
