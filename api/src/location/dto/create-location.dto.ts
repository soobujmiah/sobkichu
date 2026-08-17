/**
 * Create-address request DTO.
 *
 * Division/District/Upazila-Thana are the minimum that makes an address
 * resolvable to a district for same-city determination (compliance row C4)
 * -- everything below that is progressively more precise and optional, same
 * as the manual-fallback hierarchy in the schema (bangladesh-localization.md).
 *
 * `lat`/`lng` are both optional, deliberately: GPS is unreliable indoors and
 * in dense low-rise areas, so a location with no coordinates at all is a
 * first-class manual address, not a degraded one. LocationService rejects
 * the pair only if exactly one of the two is supplied.
 */

import { IsLatitude, IsLongitude, IsOptional, MinLength } from 'class-validator';

export class CreateLocationDto {
  @MinLength(1)
  division!: string;

  @MinLength(1)
  district!: string;

  @MinLength(1)
  upazilaThana!: string;

  @IsOptional()
  unionWard?: string;

  @IsOptional()
  villageMohalla?: string;

  @IsOptional()
  addressLine?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;
}
