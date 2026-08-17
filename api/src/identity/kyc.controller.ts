/**
 * KYC HTTP surface.
 *
 * Protected by the default global guard (no @Public()): a submission
 * attaches to the caller's own identity and active role.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthenticatedCaller } from '../common/auth/auth.guard';
import { Caller } from '../common/auth/caller.decorator';

import { SubmitKycDto } from './dto/submit-kyc.dto';
import { KycService, SubmittedKyc } from './kyc.service';

@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post()
  @HttpCode(202)
  async submit(
    @Body() dto: SubmitKycDto,
    @Caller() caller: AuthenticatedCaller,
  ): Promise<SubmittedKyc> {
    return this.kyc.submit({
      userId: caller.userId,
      activeRoleId: caller.activeRoleId,
      nidNumber: dto.nidNumber,
      documentUrls: dto.documentUrls,
    });
  }
}
