/**
 * Merchant onboarding HTTP surface.
 *
 * Protected by the default global guard (no @Public()): onboarding attaches
 * a new Role to the caller's existing identity, so it requires a session.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthenticatedCaller } from '../common/auth/auth.guard';
import { Caller } from '../common/auth/caller.decorator';

import { CreateMerchantDto } from './dto/create-merchant.dto';
import {
  CreatedMerchant,
  MerchantOnboardingService,
} from './merchant-onboarding.service';

@Controller('merchants')
export class MerchantOnboardingController {
  constructor(private readonly onboarding: MerchantOnboardingService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateMerchantDto,
    @Caller() caller: AuthenticatedCaller,
  ): Promise<CreatedMerchant> {
    return this.onboarding.createMerchant({
      // The role attaches to the verified session's user, never a body field.
      userId: caller.userId,
      pickupLocationId: dto.pickupLocationId,
      businessNameBn: dto.businessNameBn,
      businessNameEn: dto.businessNameEn,
    });
  }
}
