/**
 * Aggregator webhook payload.
 *
 * Untrusted input from an external system. The amount is validated against
 * our own pending transaction in PaymentService -- this DTO only enforces
 * shape.
 */

import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class AggregatorWebhookDto {
  @IsUUID()
  orderId!: string;

  @IsIn(['sslcommerz', 'shurjopay', 'bkash', 'nagad'])
  aggregator!: string;

  /** The aggregator's reference. Doubles as the idempotency key. */
  @IsString()
  aggregatorRef!: string;

  /** Amount in poisha. Verified against the pending transaction. */
  @IsInt()
  @Min(0)
  amountPoisha!: number;

  @IsIn(['settled', 'failed'])
  outcome!: 'settled' | 'failed';

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
