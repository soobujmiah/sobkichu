/**
 * Login and role-switching endpoints.
 *
 * `otp/*` are public by necessity: they are how a caller obtains a session
 * in the first place. `roles/*` require an existing session -- protected by
 * the default global guard, no @Public() -- since switching roles re-issues
 * a token derived from the caller's verified identity.
 */

import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';

import { AuthenticatedCaller } from '../common/auth/auth.guard';
import { Caller } from '../common/auth/caller.decorator';
import { Public } from '../common/auth/public.decorator';

import { AuthService } from './auth.service';
import { RequestOtpDto, SwitchRoleDto, VerifyOtpDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  @Get('roles')
  async listRoles(@Caller() caller: AuthenticatedCaller) {
    return this.auth.listRoles(caller.userId);
  }

  @Post('roles/switch')
  @HttpCode(200)
  async switchRole(@Body() dto: SwitchRoleDto, @Caller() caller: AuthenticatedCaller) {
    // roleId comes from the body, but ownership is checked against the
    // verified session's userId -- the body cannot make the service switch
    // into a role owned by someone else.
    return this.auth.switchRole(caller.userId, dto.roleId);
  }
}
