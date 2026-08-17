/**
 * Location repository.
 *
 * `location` owns the `location` table (docs/architecture/backend-modules.md
 * ownership table).
 *
 * A single INSERT on the pool, not a TransactionContext -- same reasoning as
 * CatalogRepository.insertListing: one statement, no multi-row invariant to
 * protect.
 */

import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '../common/database/pg.provider';

export interface NewLocationRecord {
  readonly division: string;
  readonly district: string;
  readonly upazilaThana: string;
  readonly unionWard: string | null;
  readonly villageMohalla: string | null;
  readonly addressLine: string | null;
  /** Both null, or both present -- LocationService enforces the pairing. */
  readonly lat: number | null;
  readonly lng: number | null;
}

@Injectable()
export class LocationRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async insertLocation(record: NewLocationRecord): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO location (
         division, district, upazila_thana, union_ward,
         village_mohalla, address_line, geo
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         CASE WHEN $7::double precision IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography
         END
       )
       RETURNING id`,
      [
        record.division,
        record.district,
        record.upazilaThana,
        record.unionWard,
        record.villageMohalla,
        record.addressLine,
        record.lng,
        record.lat,
      ],
    );

    return result.rows[0].id;
  }
}
