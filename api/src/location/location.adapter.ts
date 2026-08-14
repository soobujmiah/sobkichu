/**
 * Location adapter — implements LocationPort.
 *
 * `location` owns the `location` table and the BD administrative hierarchy.
 * Same-city determination lives in the order domain layer (delivery-clock.ts)
 * and consumes what this returns, so the rule has exactly one implementation.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '../common/database/pg.provider';
import { LocationPort, ResolvedLocation } from '../common/ports/location.port';

interface LocationRow {
  id: string;
  division: string;
  district: string;
  upazila_thana: string;
  union_ward: string | null;
  village_mohalla: string | null;
  address_line: string | null;
  has_geo: boolean;
}

@Injectable()
export class LocationAdapter implements LocationPort {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findById(locationId: string): Promise<ResolvedLocation> {
    const result = await this.pool.query<LocationRow>(
      `SELECT id, division, district, upazila_thana, union_ward,
              village_mohalla, address_line,
              (geo IS NOT NULL) AS has_geo
         FROM location
        WHERE id = $1`,
      [locationId],
    );

    const row = result.rows[0];

    if (!row) {
      throw new NotFoundException('error.address.not_found');
    }

    return {
      id: row.id,
      division: row.division,
      district: row.district,
      upazilaThana: row.upazila_thana,
      unionWard: row.union_ward,
      villageMohalla: row.village_mohalla,
      addressLine: row.address_line,
      // Deliberately exposed as a boolean, not coordinates: a null geo is a
      // manual-address location, which is a first-class path and not a
      // degraded one (docs/localization/bangladesh-localization.md).
      hasGeo: row.has_geo,
    };
  }
}
