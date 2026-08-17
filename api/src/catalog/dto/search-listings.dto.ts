/**
 * Radius-search query DTO.
 *
 * Query strings arrive as strings; `@Type(() => Number)` plus the global
 * `ValidationPipe({ transform: true })` (main.ts) coerce them before
 * class-validator runs.
 */

import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, Max, Min } from 'class-validator';

export class SearchListingsDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  /** Roadmap Phase 1 DoD: "GPS radius discovery (1-10 km)". */
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  radiusKm!: number;
}
