/**
 * Merchant-onboarding request DTO.
 *
 * Registers the merchant Role itself -- business profile and pickup
 * location. NID KYC is a separate, not-yet-built flow (compliance row K1
 * lives on `role.kyc_status` / `app_user.nid_verification_status`, both of
 * which stay at their schema defaults here). A merchant can exist unverified
 * for exactly as long as it takes to complete KYC; CatalogService and
 * OrderService are what actually gate publishing and transacting on it.
 */

import { IsOptional, IsUUID, MinLength } from 'class-validator';

export class CreateMerchantDto {
  /**
   * An existing location id. There is no "create address" endpoint yet
   * (docs/roadmap.md Phase 1 DoD), so this follows the same convention as
   * CreateOrderDto.deliveryLocationId: the client already has one, resolved
   * some other way, and the server validates it exists rather than trusting
   * it blindly (LOCATION_PORT.findById is not called here to avoid a new
   * identity -> location module dependency; the `location` foreign key does
   * the same job as the last line of defence -- ADR-0005).
   */
  @IsUUID()
  pickupLocationId!: string;

  @MinLength(1)
  businessNameBn!: string;

  @IsOptional()
  businessNameEn?: string;
}
