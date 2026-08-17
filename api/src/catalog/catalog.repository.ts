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
         price_bdt, ready_to_ship, stock_qty
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
      ],
    );

    return result.rows[0].id;
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
