/**
 * Catalog adapter — implements CatalogPort for the `order` module.
 *
 * The port is the contract; this is the only implementation that touches
 * the database. `order` depends on the interface, never on this class, which
 * is what lets order.service.spec.ts run 26 cases with no database at all.
 */

import { Injectable, NotFoundException } from '@nestjs/common';

import { takaToPoisha } from '../common/money';
import {
  CatalogPort,
  RequestedCartLine,
  ResolvedCartLine,
} from '../common/ports/catalog.port';

import { CatalogRepository } from './catalog.repository';

@Injectable()
export class CatalogAdapter implements CatalogPort {
  constructor(private readonly listings: CatalogRepository) {}

  /**
   * Resolve requested lines against current catalog state.
   *
   * Two properties the caller depends on:
   *
   *  1. Returns lines in the SAME ORDER as requested. OrderService zips the
   *     result against the request by index, so a reordered result would
   *     attach the wrong price to the wrong listing.
   *
   *  2. Throws when any id is unknown, rather than silently dropping it. A
   *     dropped line would produce an order whose total is lower than the
   *     buyer's cart -- and a correspondingly wrong advance cap.
   */
  async resolveCartLines(
    lines: readonly RequestedCartLine[],
  ): Promise<ResolvedCartLine[]> {
    const ids = lines.map((line) => line.listingId);
    const rows = await this.listings.findByIds(ids);
    const byId = new Map(rows.map((row) => [row.id, row]));

    return lines.map((line) => {
      const row = byId.get(line.listingId);

      if (!row) {
        throw new NotFoundException('error.checkout.listing_not_found');
      }

      return {
        listingId: row.id,
        quantity: line.quantity,
        // NUMERIC(12,2) arrives as a string from pg; converting here keeps
        // float out of the money path entirely.
        unitPrice: takaToPoisha(row.price_bdt),
        readyToShip: row.ready_to_ship,
        merchantRoleId: row.owner_role_id,
        categoryRestricted: row.category_restricted,
        categoryRequiresDgdaLicence: row.category_requires_dgda_licence,
        stockQty: row.stock_qty,
        isActive: row.is_active,
      };
    });
  }
}
