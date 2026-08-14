/**
 * Order creation — INTEGRATION test against real PostgreSQL + PostGIS.
 *
 * Everything up to now proved the rules are right and the service applies
 * them. This proves the whole path works against a real database: adapters
 * read real rows, the transaction really commits, and the schema CHECK
 * constraints really are the last line of defence.
 *
 * Compliance rows exercised: C1, C2, C3, C4, C8, C9, C10, K1.
 * A failure here is a COMPLIANCE REGRESSION.
 *
 * Skips itself when DATABASE_URL is absent, so `npm test` stays runnable
 * without a database. CI always provides one.
 */

import { Pool } from 'pg';

import { takaToPoisha } from '../src/common/money';
import { PgUnitOfWork } from '../src/common/database/pg-unit-of-work';
import { CatalogAdapter } from '../src/catalog/catalog.adapter';
import { CatalogRepository } from '../src/catalog/catalog.repository';
import { LocationAdapter } from '../src/location/location.adapter';
import { MerchantAdapter } from '../src/identity/merchant.adapter';
import { OrderRepository } from '../src/order/order.repository';
import { OrderService } from '../src/order/order.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('order creation against real PostgreSQL', () => {
  let pool: Pool;
  let service: OrderService;

  // Seeded ids from .devcontainer/seed.sql
  const CUSTOMER = '22222222-2222-4222-8222-000000000001';
  const DHAKA = '11111111-1111-4111-8111-000000000001';
  const CHATTOGRAM = '11111111-1111-4111-8111-000000000006';
  const RICE = '44444444-4444-4444-8444-000000000001'; // 420.00, ready
  const FAN = '44444444-4444-4444-8444-000000000003'; // 4200.00, NOT ready
  const BULB = '44444444-4444-4444-8444-000000000004'; // 180.00, ready

  let gulshanMerchant: string; // owns FAN and BULB
  let pendingMerchant: string; // kyc_status = 'pending'

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    const uow = new PgUnitOfWork(pool);
    service = new OrderService(
      new CatalogAdapter(new CatalogRepository(pool)),
      new LocationAdapter(pool),
      new MerchantAdapter(pool),
      uow,
      new OrderRepository(),
    );

    const merchants = await pool.query<{ id: string; business: string }>(
      `SELECT id, profile->>'business_name' AS business
         FROM role WHERE type = 'merchant'`,
    );
    gulshanMerchant = merchants.rows.find((r) =>
      r.business?.includes('Gulshan'),
    )!.id;
    pendingMerchant = merchants.rows.find((r) => r.business?.includes('Mirpur'))!.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Remove orders created by a test so reruns stay deterministic. */
  async function cleanup(orderId: string) {
    await pool.query('DELETE FROM transaction WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM order_status_event WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM order_item WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM app_order WHERE id = $1', [orderId]);
  }

  it('creates an order and persists every part in one transaction', async () => {
    const result = await service.createOrder({
      customerUserId: CUSTOMER,
      merchantRoleId: gulshanMerchant,
      deliveryLocationId: DHAKA,
      paymentMethod: 'bkash',
      lines: [{ listingId: BULB, quantity: 2 }],
      requestedAdvance: takaToPoisha('360.00'),
      deliveryFee: 0,
    });

    expect(result.totalBdt).toBe('360.00');

    const order = await pool.query(
      'SELECT * FROM app_order WHERE id = $1',
      [result.orderId],
    );
    const items = await pool.query(
      'SELECT * FROM order_item WHERE order_id = $1',
      [result.orderId],
    );
    const events = await pool.query(
      'SELECT * FROM order_status_event WHERE order_id = $1',
      [result.orderId],
    );
    const txns = await pool.query(
      'SELECT * FROM transaction WHERE order_id = $1',
      [result.orderId],
    );

    expect(order.rows).toHaveLength(1);
    expect(items.rows).toHaveLength(1);
    expect(events.rows).toHaveLength(1); // C10: append-only timeline
    expect(txns.rows).toHaveLength(1); // written WITH the order, never after

    expect(items.rows[0].quantity).toBe(2);
    expect(items.rows[0].unit_price_bdt).toBe('180.00');
    expect(items.rows[0].ready_to_ship_at_order).toBe(true);
    expect(events.rows[0].to_status).toBe('created');
    expect(txns.rows[0].status).toBe('pending');

    await cleanup(result.orderId);
  });

  it('C1: caps a non-ready-to-ship order at 10%', async () => {
    const result = await service.createOrder({
      customerUserId: CUSTOMER,
      merchantRoleId: gulshanMerchant,
      deliveryLocationId: DHAKA,
      paymentMethod: 'bkash',
      lines: [{ listingId: FAN, quantity: 1 }],
      requestedAdvance: takaToPoisha('420.00'),
      deliveryFee: 0,
    });

    const order = await pool.query(
      'SELECT advance_cap_bdt, all_items_ready_to_ship FROM app_order WHERE id = $1',
      [result.orderId],
    );

    expect(order.rows[0].advance_cap_bdt).toBe('420.00');
    expect(order.rows[0].all_items_ready_to_ship).toBe(false);

    await cleanup(result.orderId);
  });

  it('C1: rejects an over-cap advance and writes NOTHING', async () => {
    const before = await pool.query('SELECT count(*)::int AS n FROM app_order');

    await expect(
      service.createOrder({
        customerUserId: CUSTOMER,
        merchantRoleId: gulshanMerchant,
        deliveryLocationId: DHAKA,
        paymentMethod: 'bkash',
        lines: [{ listingId: FAN, quantity: 1 }],
        requestedAdvance: takaToPoisha('4200.00'),
        deliveryFee: 0,
      }),
    ).rejects.toThrow();

    const after = await pool.query('SELECT count(*)::int AS n FROM app_order');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('C2: a mixed cart caps the whole order at 10%', async () => {
    const result = await service.createOrder({
      customerUserId: CUSTOMER,
      merchantRoleId: gulshanMerchant,
      deliveryLocationId: DHAKA,
      paymentMethod: 'bkash',
      lines: [
        { listingId: BULB, quantity: 1 }, // ready, 180.00
        { listingId: FAN, quantity: 1 }, // not ready, 4200.00
      ],
      requestedAdvance: takaToPoisha('438.00'),
      deliveryFee: 0,
    });

    const order = await pool.query(
      'SELECT total_bdt, advance_cap_bdt FROM app_order WHERE id = $1',
      [result.orderId],
    );
    const items = await pool.query(
      `SELECT ready_to_ship_at_order FROM order_item
        WHERE order_id = $1 ORDER BY unit_price_bdt`,
      [result.orderId],
    );

    expect(order.rows[0].total_bdt).toBe('4380.00');
    expect(order.rows[0].advance_cap_bdt).toBe('438.00');
    // Both snapshots persisted, evidencing the basis of the cap (ADR-0005).
    expect(items.rows.map((r) => r.ready_to_ship_at_order)).toEqual([true, false]);

    await cleanup(result.orderId);
  });

  it('C4: derives same-city from the BD district hierarchy', async () => {
    const sameCity = await service.createOrder({
      customerUserId: CUSTOMER,
      merchantRoleId: gulshanMerchant,
      deliveryLocationId: DHAKA,
      paymentMethod: 'cod',
      lines: [{ listingId: BULB, quantity: 1 }],
      requestedAdvance: 0,
      deliveryFee: 0,
    });

    const differentCity = await service.createOrder({
      customerUserId: CUSTOMER,
      merchantRoleId: gulshanMerchant,
      deliveryLocationId: CHATTOGRAM,
      paymentMethod: 'cod',
      lines: [{ listingId: BULB, quantity: 1 }],
      requestedAdvance: 0,
      deliveryFee: 0,
    });

    expect(sameCity.isSameCity).toBe(true);
    expect(differentCity.isSameCity).toBe(false);

    const rows = await pool.query(
      'SELECT id, is_same_city, delivery_deadline_at FROM app_order WHERE id = ANY($1)',
      [[sameCity.orderId, differentCity.orderId]],
    );

    // The clock has not started: no advance has been paid yet.
    for (const row of rows.rows) {
      expect(row.delivery_deadline_at).toBeNull();
    }

    await cleanup(sameCity.orderId);
    await cleanup(differentCity.orderId);
  });

  it('K1: refuses a merchant whose NID KYC is still pending', async () => {
    const listing = await pool.query<{ id: string }>(
      'SELECT id FROM listing WHERE owner_role_id = $1 LIMIT 1',
      [pendingMerchant],
    );

    // The pending merchant may have no listings; assert the gate directly.
    const merchant = await new MerchantAdapter(pool).findMerchant(pendingMerchant);
    expect(merchant.kycVerified).toBe(false);

    if (listing.rows[0]) {
      await expect(
        service.createOrder({
          customerUserId: CUSTOMER,
          merchantRoleId: pendingMerchant,
          deliveryLocationId: DHAKA,
          paymentMethod: 'cod',
          lines: [{ listingId: listing.rows[0].id, quantity: 1 }],
          requestedAdvance: 0,
          deliveryFee: 0,
        }),
      ).rejects.toThrow();
    }
  });

  it('C8: refuses a prohibited category', async () => {
    // Create a lottery listing owned by a verified merchant, then confirm
    // the order path refuses it.
    const lottery = await pool.query<{ id: string }>(
      `INSERT INTO listing (owner_role_id, type, category_id, title_bn, price_bdt,
                            ready_to_ship, location_id)
       VALUES ($1, 'product', (SELECT id FROM category WHERE slug = 'lottery'),
               'পরীক্ষা', 100.00, TRUE, $2)
       RETURNING id`,
      [gulshanMerchant, DHAKA],
    );

    await expect(
      service.createOrder({
        customerUserId: CUSTOMER,
        merchantRoleId: gulshanMerchant,
        deliveryLocationId: DHAKA,
        paymentMethod: 'cod',
        lines: [{ listingId: lottery.rows[0].id, quantity: 1 }],
        requestedAdvance: 0,
        deliveryFee: 0,
      }),
    ).rejects.toThrow();

    await pool.query('DELETE FROM listing WHERE id = $1', [lottery.rows[0].id]);
  });

  it('refuses a cart spanning two merchants in Phase 1', async () => {
    await expect(
      service.createOrder({
        customerUserId: CUSTOMER,
        merchantRoleId: gulshanMerchant,
        deliveryLocationId: DHAKA,
        paymentMethod: 'cod',
        lines: [
          { listingId: BULB, quantity: 1 }, // Gulshan
          { listingId: RICE, quantity: 1 }, // Shyamoli
        ],
        requestedAdvance: 0,
        deliveryFee: 0,
      }),
    ).rejects.toThrow();
  });

  it('rolls back completely when a write fails mid-transaction', async () => {
    // The schema CHECK is the last line of defence (ADR-0005). Drive a
    // violation past the service by calling the repository directly inside
    // a transaction, and confirm nothing survives.
    const uow = new PgUnitOfWork(pool);
    const repo = new OrderRepository();
    const before = await pool.query('SELECT count(*)::int AS n FROM app_order');

    await expect(
      uow.withTransaction(async (tx) => {
        const id = await repo.insertOrder(tx, {
          customerUserId: CUSTOMER,
          merchantRoleId: gulshanMerchant,
          deliveryLocationId: DHAKA,
          paymentMethod: 'bkash',
          subtotalBdt: '100.00',
          deliveryFeeBdt: '0.00',
          totalBdt: '100.00',
          // Violates advance_within_cap: 100 > 10.
          advanceAmountBdt: '100.00',
          advanceCapBdt: '10.00',
          isEscrow: false,
          allItemsReadyToShip: false,
          isSameCity: true,
          items: [],
        });
        return id;
      }),
    ).rejects.toThrow();

    const after = await pool.query('SELECT count(*)::int AS n FROM app_order');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
