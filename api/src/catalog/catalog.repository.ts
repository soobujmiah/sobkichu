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

@Injectable()
export class CatalogRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

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
