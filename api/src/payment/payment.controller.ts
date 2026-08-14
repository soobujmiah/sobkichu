/**
 * Payment webhook endpoint.
 *
 * Thin: verify the signature, map the payload, delegate. All settlement
 * logic lives in PaymentService so it is testable without HTTP.
 *
 * Answers 200 for duplicates. Aggregators retry on non-2xx, so returning an
 * error for an already-applied webhook would cause an indefinite retry loop
 * over work that is already done.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { Public } from '../identity/public.decorator';

import { AggregatorWebhookDto } from './dto/aggregator-webhook.dto';
import { PaymentService } from './payment.service';
import { verifyWebhookSignature } from './webhook-signature';

@Controller('payments/webhook')
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly config: ConfigService,
  ) {}

  // No session: an external payment provider cannot hold one. It
  // authenticates with an HMAC signature over the raw body instead.
  @Public()
  @Post(':aggregator')
  @HttpCode(200)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Body() dto: AggregatorWebhookDto,
    @Headers('x-signature') signature: string,
  ) {
    const secret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!secret) {
      // Deployment error, not a client error. Fail closed rather than
      // accepting unverified settlements.
      throw new UnauthorizedException('error.webhook.not_configured');
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException('error.webhook.raw_body_unavailable');
    }

    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('error.webhook.invalid_signature');
    }

    const result = await this.payments.applySettlement({
      orderId: dto.orderId,
      aggregator: dto.aggregator,
      aggregatorRef: dto.aggregatorRef,
      amount: dto.amountPoisha,
      outcome: dto.outcome,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });

    return result;
  }
}
