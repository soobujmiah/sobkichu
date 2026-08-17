/**
 * KYC submission request DTO.
 *
 * `documentUrls` are references into object storage the client uploaded to
 * separately -- upload/storage wiring is separate, not-yet-built work
 * (S3-compatible storage is locked-stack per README.md but nothing exposes
 * it yet). Per the compliance matrix, document CONTENT never travels
 * through or lives in this API -- only reference URLs do.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';

export class SubmitKycDto {
  @IsString()
  @Length(10, 20)
  nidNumber!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  documentUrls!: string[];
}
