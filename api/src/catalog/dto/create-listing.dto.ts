/**
 * Create-listing request DTO.
 *
 * Note what is ABSENT: owner_role_id and location_id. The owner is the
 * caller's active merchant role (from the verified session, never the body
 * -- see CatalogService.createListing); the location is the merchant's
 * registered pickup location. Accepting either from the client would let a
 * caller publish a listing under another merchant's identity or address.
 */

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateListingDto {
  @IsIn(['product', 'service_slot'])
  type!: 'product' | 'service_slot';

  @IsUUID()
  categoryId!: string;

  @MinLength(1)
  titleBn!: string;

  @IsOptional()
  titleEn?: string;

  @IsOptional()
  descriptionBn?: string;

  @IsOptional()
  descriptionEn?: string;

  /**
   * Price in POISHA (integer 1/100 taka), not taka -- same convention as
   * CreateOrderDto.requestedAdvancePoisha. Converted to the NUMERIC(12,2)
   * `price_bdt` column at the repository boundary (common/money.ts).
   */
  @IsInt()
  @Min(0)
  priceBdtPoisha!: number;

  /**
   * Deliverable within 72 hours (DCOG 2021, compliance row C2). Drives the
   * advance-payment cap on every order that includes this listing -- a
   * merchant misdeclaring this is a compliance issue, not a UX one.
   */
  @IsBoolean()
  readyToShip!: boolean;

  /** Null for service slots; required (non-negative) for products. */
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQty?: number;
}
