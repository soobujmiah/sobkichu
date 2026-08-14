/**
 * Create-order request DTO.
 *
 * Note what is ABSENT: price, ready_to_ship, advance cap, same-city. Those
 * all feed the advance-payment cap and the delivery clock, so they are
 * resolved server-side. Accepting them from a client would let the caller
 * choose its own legal ceiling.
 *
 * The client sends identifiers, quantities and an intent to pay.
 */

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderLineDto {
  @IsUUID()
  listingId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsUUID()
  merchantRoleId!: string;

  @IsUUID()
  deliveryLocationId!: string;

  @IsIn(['bkash', 'nagad', 'cod', 'escrow'])
  paymentMethod!: 'bkash' | 'nagad' | 'cod' | 'escrow';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines!: CreateOrderLineDto[];

  /**
   * Requested advance in POISHA (integer 1/100 taka), not taka.
   *
   * Integer transport avoids the client sending "420.00" and the server
   * having to trust a decimal string in a compliance-bearing field.
   */
  @IsInt()
  @Min(0)
  requestedAdvancePoisha!: number;
}
