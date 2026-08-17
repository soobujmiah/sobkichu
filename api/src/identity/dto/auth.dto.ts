/**
 * Login DTOs.
 *
 * The phone is normalised server-side (normaliseBdPhone), so the DTO only
 * enforces a loose shape -- users type 01712345678, 8801712345678 and
 * +880 1712-345678, and all three are the same person.
 */

import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Length(10, 20)
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @Length(10, 20)
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'error.auth.code_must_be_six_digits' })
  code!: string;
}

export class SwitchRoleDto {
  @IsUUID()
  roleId!: string;
}
