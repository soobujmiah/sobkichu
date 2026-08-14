/**
 * Catalog adapter tests.
 *
 * The adapter is where database rows become domain values, so the risks are
 * ordering, missing rows, and the NUMERIC-string to poisha conversion. All
 * three would corrupt the advance cap silently.
 */

import { NotFoundException } from '@nestjs/common';

import { poishaToTaka } from '../common/money';

import { CatalogAdapter } from './catalog.adapter';
import { CatalogRepository, ListingRow } from './catalog.repository';

const row = (id: string, price: string, readyToShip = true): ListingRow => ({
  id,
  owner_role_id: 'merchant-1',
  price_bdt: price,
  ready_to_ship: readyToShip,
  stock_qty: 10,
  is_active: true,
  category_restricted: false,
  category_requires_dgda_licence: false,
});

/** Returns rows in a deliberately different order than requested. */
class ShuffledRepository extends CatalogRepository {
  constructor(private readonly rows: ListingRow[]) {
    super(undefined as never);
  }

  override async findByIds(ids: readonly string[]): Promise<ListingRow[]> {
    return this.rows.filter((r) => ids.includes(r.id)).reverse();
  }
}

describe('CatalogAdapter', () => {
  it('returns lines in REQUESTED order, not database order', async () => {
    // OrderService zips the result against the request by index. A reordered
    // result would attach the wrong price to the wrong listing.
    const adapter = new CatalogAdapter(
      new ShuffledRepository([row('a', '100.00'), row('b', '200.00')]),
    );

    const resolved = await adapter.resolveCartLines([
      { listingId: 'a', quantity: 1 },
      { listingId: 'b', quantity: 1 },
    ]);

    expect(resolved.map((l) => l.listingId)).toEqual(['a', 'b']);
    expect(poishaToTaka(resolved[0].unitPrice)).toBe('100.00');
    expect(poishaToTaka(resolved[1].unitPrice)).toBe('200.00');
  });

  it('throws when a listing id is unknown, rather than dropping the line', async () => {
    // A dropped line would produce an order whose total is lower than the
    // buyer's cart, and a correspondingly wrong advance cap.
    const adapter = new CatalogAdapter(new ShuffledRepository([row('a', '100.00')]));

    await expect(
      adapter.resolveCartLines([
        { listingId: 'a', quantity: 1 },
        { listingId: 'missing', quantity: 1 },
      ]),
    ).rejects.toThrow(NotFoundException);
  });

  it('converts NUMERIC strings to poisha without touching float', async () => {
    const adapter = new CatalogAdapter(new ShuffledRepository([row('a', '1234.56')]));

    const [line] = await adapter.resolveCartLines([{ listingId: 'a', quantity: 1 }]);

    expect(line.unitPrice).toBe(123456);
    expect(poishaToTaka(line.unitPrice)).toBe('1234.56');
  });

  it('carries the compliance flags through unchanged', async () => {
    const restricted: ListingRow = {
      ...row('a', '100.00'),
      category_restricted: true,
      category_requires_dgda_licence: true,
      is_active: false,
      stock_qty: null,
    };
    const adapter = new CatalogAdapter(new ShuffledRepository([restricted]));

    const [line] = await adapter.resolveCartLines([{ listingId: 'a', quantity: 1 }]);

    expect(line.categoryRestricted).toBe(true);
    expect(line.categoryRequiresDgdaLicence).toBe(true);
    expect(line.isActive).toBe(false);
    expect(line.stockQty).toBeNull();
  });

  it('preserves the requested quantity, not any stored default', async () => {
    const adapter = new CatalogAdapter(new ShuffledRepository([row('a', '100.00')]));

    const [line] = await adapter.resolveCartLines([{ listingId: 'a', quantity: 7 }]);

    expect(line.quantity).toBe(7);
  });

  it('handles an empty cart without querying', async () => {
    const adapter = new CatalogAdapter(new ShuffledRepository([]));

    await expect(adapter.resolveCartLines([])).resolves.toEqual([]);
  });
});
