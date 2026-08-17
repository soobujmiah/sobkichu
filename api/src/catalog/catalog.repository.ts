/**
 * Catalog repository.
 *
 * `catalog` owns `listing` and `category` (docs/architecture/backend-modules.md
 * ownership table). This is the only place those tables are read.
 *
 * Reads here run OUTSIDE the order transaction, on the pool. That is
 * deliberate: cart resolution happens before the transaction opens, so a
 * slow catalog read never holds a write transaction open. The prices it
 * returns are snapshotted into order_item inside the transaction, so a
 * concurrent price change cannot alter an order already being written.
 */

import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '../common/database/pg.provider';

export interface ListingRow {
  id: string;
  owner_role_id: string;
  price_bdt: string;
  ready_to_ship: boolean;
  stock_qty: number | null;
  is_active: boolean;
  category_restricted: boolean;
  category_requires_dgda_licence: boolean;
}

export interface CategoryRow {
  id: string;
  is_restricted: boolean;
  requires_dgda_licence: boolean;
}

export interface NewListingRecord {
  readonly ownerRoleId: string;
  readonly locationId: string;
  readonly type: 'product' | 'service_slot';
  readonly categoryId: string;
  readonly titleBn: string;
  readonly titleEn: string | null;
  readonly descriptionBn: string | null;
  readonly descriptionEn: string | null;
  /** NUMERIC(12,2) string -- converted from poisha at the service boundary. */
  readonly priceBdt: string;
  readonly readyToShip: boolean;
  readonly stockQty: number | null;
  /**
   * Denormalised from the owning merchant's pickup location, both null when
   * that location has no GPS fix. `listing.geo` exists so radius search runs
   * entirely within this table -- see the GIST index in the schema.
   */
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface NearbyListingRow {
  id: string;
  title_bn: string;
  title_en: string | null;
  price_bdt: string;
  ready_to_ship: boolean;
  type: 'product' | 'service_slot';
  distance_m: number;
}

@Injectable()
export class CatalogRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Fetch a category's compliance flags.
   *
   * Read on the pool, not a transaction -- listing creation is a single
   * statement, so there is no multi-statement invariant to protect (unlike
   * order creation, which is why OrderRepository takes a TransactionContext).
   */
  async findCategory(id: string): Promise<CategoryRow | null> {
    const result = await this.pool.query<CategoryRow>(
      `SELECT id, is_restricted, requires_dgda_licence
         FROM category
        WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async insertListing(record: NewListingRecord): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO listing (
         owner_role_id, location_id, type, category_id,
         title_bn, title_en, description_bn, description_en,
         price_bdt, ready_to_ship, stock_qty, geo
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
         CASE WHEN $12::double precision IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($12, $13), 4326)::geography
         END
       )
       RETURNING id`,
      [
        record.ownerRoleId,
        record.locationId,
        record.type,
        record.categoryId,
        record.titleBn,
        record.titleEn,
        record.descriptionBn,
        record.descriptionEn,
        record.priceBdt,
        record.readyToShip,
        record.stockQty,
        record.lng,
        record.lat,
      ],
    );

    return result.rows[0].id;
  }

  /**
   * Radius search (roadmap Phase 1 DoD: "GPS radius discovery (1-10 km)").
   *
   * Runs entirely against `listing.geo` -- no join back to `location` (or to
   * `role`), by design (boundary rule 1). Listings whose merchant has no GPS
   * fix on file simply have `geo IS NULL` and never match; the manual-address
   * discovery path is a separate, non-radius query this method does not
   * cover.
   */
  async searchNearby(
    lat: number,
    lng: number,
    radiusMeters: number,
    limit: number,
  ): Promise<NearbyListingRow[]> {
    const result = await this.pool.query<NearbyListingRow>(
      `SELECT l.id, l.title_bn, l.title_en, l.price_bdt, l.ready_to_ship, l.type,
              ST_Distance(l.geo, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
                AS distance_m
         FROM listing l
        WHERE l.is_active
          AND l.geo IS NOT NULL
          AND ST_DWithin(
                l.geo,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                $3
              )
        ORDER BY distance_m ASC
        LIMIT $4`,
      [lng, lat, radiusMeters, limit],
    );

    return result.rows;
  }

  /**
   * Fetch listings by id, joined to their category's compliance flags.
   *
   * One query for the whole cart rather than N queries -- a 50-line cart on
   * a metered 3G connection should not cost 50 round trips to the database.
   */
  async findByIds(ids: readonly string[]): Promise<ListingRow[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.pool.query<ListingRow>(
      `SELECT l.id,
              l.owner_role_id,
              l.price_bdt,
              l.ready_to_ship,
              l.stock_qty,
              l.is_active,
              c.is_restricted          AS category_restricted,
              c.requires_dgda_licence  AS category_requires_dgda_licence
         FROM listing l
         JOIN category c ON c.id = l.category_id
        WHERE l.id = ANY($1::uuid[])`,
      [ids as string[]],
    );

    return result.rows;
  }
}
