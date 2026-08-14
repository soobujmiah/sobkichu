/**
 * Payment settlement — INTEGRATION test against real PostgreSQL.
 *
 * Proves the two claims that unit tests with fakes cannot:
 *   - a replayed webhook leaves the database byte-for-byte unchanged
 *   - the delivery clock is really stamped, with the regulated window
 *
 * Compliance rows: C4 (delivery clock), C10 (append-only timeline), plus the
 * Section 8 atomicity requirement.
 */

import { Pool } from 'pg';

import { takaToPoisha } from '../src/common/money';
import { PgUnitOfWork } from '../src/common/database/pg-unit-of-work';
import { CatalogAdapter } from '../src/catalog/catalog.adapter';
import { CatalogRepository } from '../src/catalog/catalog.repository';
import { LocationAdapter } from '../src/location/location.adapter';
import { MerchantAdapter } from '../src/identity/merchant.adapter';
import { OrderAdapter } from '../src/order/order.adapter';
import { OrderRepository } from '../src/order/order.repository';
import { OrderService } from '../src/order/order.service';
import { PaymentRepository } from '../src/payment/payment.repository';
import { PaymentService } from '../src/payment/payment.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('payment settlement against real PostgreSQL', () => {
  let pool: Pool;
  let orderService: OrderService;
  let paymentService: PaymentService;

  const CUSTOMER = '22222222-2222-4222-8222-000000000001';
  const DHAKA = '11111111-1111-4111-8111-000000000001';
  const CHATTOGRAM = '11111111-1111-4111-8111-000000000006';
  const BULB = '44444444-4444-4444-8444-000000000004'; // 180.00, ready to ship

  let merchant: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const uow = new PgUnitOfWork(pool);
    const orderRepo = new OrderRepository();

    orderService = new OrderService(
      new CatalogAdapter(new CatalogRepository(pool)),
      new LocationAdapter(pool),
      new MerchantAdapter(pool),
      uow,
      orderRepo,
    );

    paymentService = new PaymentService(
      uow,
      new OrderAdapter(orderRepo),
      new PaymentRepository(),
    );

    const rows = await pool.query<{ id: string }>(
      `SELECT id FROM role
        WHERE type = 'merchant' AND profile->>'business_name' LIKE '%Gulshan%'`,
    );
    merchant = rows.rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function placeOrder(deliveryLocationId = DHAKA, advance = '180.00') {
    return orderService.createOrder({
      customerUserId: CUSTOMER,
      merchantRoleId: merchant,
      deliveryLocationId,
      paymentMethod: 'bkash',
      lines: [{ listingId: BULB, quantity: 1 }],
      requestedAdvance: takaToPoisha(advance),
      deliveryFee: 0,
    });
  }

  async function cleanup(orderId: string) {
    await pool.query('DELETE FROM transaction WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM order_status_event WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM order_item WHERE order_id = $1', [orderId]);
    await pool.query('DELETE FROM app_order WHERE id = $1', [orderId]);
  }

  it('C4: stamps a 5-day deadline for a same-city advance payment', async () => {
    const order = await placeOrder(DHAKA);
    const paidAt = new Date('2026-08-14T10:00:00Z');

    const result = await paymentService.applySettlement({
      orderId: order.orderId,
      aggregator: 'sslcommerz',
      aggregatorRef: `REF-SAME-${Date.now()}`,
      amount: takaToPoisha('180.00'),
      outcome: 'settled',
      occurredAt: paidAt,
    });

    expect(result.status).toBe('applied');

    const row = await pool.query(
      `SELECT status, advance_paid_at, delivery_deadline_at,
              (delivery_deadline_at - advance_paid_at) AS window
         FROM app_order WHERE id = $1`,
      [order.orderId],
    );

    expect(row.rows[0].status).toBe('confirmed');
    expect(row.rows[0].advance_paid_at).toEqual(paidAt);
    // The regulated window, computed by the domain layer and persisted.
    expect(row.rows[0].window).toEqual({ days: 5 });

    await cleanup(order.orderId);
  });

  it('C4: stamps a 10-day deadline for a different-city advance', async () => {
    const order = await placeOrder(CHATTOGRAM);

    await paymentService.applySettlement({
      orderId: order.orderId,
      aggregator: 'sslcommerz',
      aggregatorRef: `REF-DIFF-${Date.now()}`,
      amount: takaToPoisha('180.00'),
      outcome: 'settled',
      occurredAt: new Date('2026-08-14T10:00:00Z'),
    });

    const row = await pool.query(
      `SELECT (delivery_deadline_at - advance_paid_at) AS window
         FROM app_order WHERE id = $1`,
      [order.orderId],
    );

    expect(row.rows[0].window).toEqual({ days: 10 });

    await cleanup(order.orderId);
  });

  it('a replayed webhook leaves the database unchanged', async () => {
    const order = await placeOrder();
    const ref = `REF-REPLAY-${Date.now()}`;
    const notice = {
      orderId: order.orderId,
      aggregator: 'sslcommerz',
      aggregatorRef: ref,
      amount: takaToPoisha('180.00'),
      outcome: 'settled' as const,
      occurredAt: new Date('2026-08-14T10:00:00Z'),
    };

    const first = await paymentService.applySettlement(notice);
    expect(first.status).toBe('applied');

    const snapshot = await pool.query(
      `SELECT status, advance_paid_at, delivery_deadline_at, updated_at
         FROM app_order WHERE id = $1`,
      [order.orderId],
    );
    const txnsAfterFirst = await pool.query(
      'SELECT count(*)::int AS n FROM transaction WHERE order_id = $1',
      [order.orderId],
    );
    const eventsAfterFirst = await pool.query(
      'SELECT count(*)::int AS n FROM order_status_event WHERE order_id = $1',
      [order.orderId],
    );

    // Aggregators retry. Deliver the identical webhook twice more.
    const second = await paymentService.applySettlement(notice);
    const third = await paymentService.applySettlement(notice);

    expect(second.status).toBe('duplicate');
    expect(third.status).toBe('duplicate');

    const after = await pool.query(
      `SELECT status, advance_paid_at, delivery_deadline_at, updated_at
         FROM app_order WHERE id = $1`,
      [order.orderId],
    );
    const txnsAfter = await pool.query(
      'SELECT count(*)::int AS n FROM transaction WHERE order_id = $1',
      [order.orderId],
    );
    const eventsAfter = await pool.query(
      'SELECT count(*)::int AS n FROM order_status_event WHERE order_id = $1',
      [order.orderId],
    );

    // Byte-for-byte identical, including updated_at: nothing was rewritten.
    expect(after.rows[0]).toEqual(snapshot.rows[0]);
    expect(txnsAfter.rows[0].n).toBe(txnsAfterFirst.rows[0].n);
    expect(eventsAfter.rows[0].n).toBe(eventsAfterFirst.rows[0].n);

    await cleanup(order.orderId);
  });

  it('rejects a settlement whose amount disagrees with our record', async () => {
    const order = await placeOrder();

    const result = await paymentService.applySettlement({
      orderId: order.orderId,
      aggregator: 'sslcommerz',
      aggregatorRef: `REF-BAD-${Date.now()}`,
      amount: takaToPoisha('999.00'),
      outcome: 'settled',
      occurredAt: new Date(),
    });

    expect(result).toEqual({ status: 'rejected', reason: 'amount_mismatch' });

    const row = await pool.query(
      'SELECT status, delivery_deadline_at FROM app_order WHERE id = $1',
      [order.orderId],
    );

    // Untouched: no confirmation, no clock.
    expect(row.rows[0].status).toBe('created');
    expect(row.rows[0].delivery_deadline_at).toBeNull();

    await cleanup(order.orderId);
  });

  it('C10: appends to the status timeline rather than overwriting it', async () => {
    const order = await placeOrder();

    await paymentService.applySettlement({
      orderId: order.orderId,
      aggregator: 'sslcommerz',
      aggregatorRef: `REF-TIMELINE-${Date.now()}`,
      amount: takaToPoisha('180.00'),
      outcome: 'settled',
      occurredAt: new Date('2026-08-14T10:00:00Z'),
    });

    const events = await pool.query(
      `SELECT from_status, to_status, note_key
         FROM order_status_event WHERE order_id = $1 ORDER BY occurred_at`,
      [order.orderId],
    );

    // Both the creation and the confirmation survive as evidence.
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0].to_status).toBe('created');
    expect(events.rows[1].from_status).toBe('created');
    expect(events.rows[1].to_status).toBe('confirmed');
    expect(events.rows[1].note_key).toBe('order.event.payment_received');

    await cleanup(order.orderId);
  });

  it('the UNIQUE constraint blocks a duplicate ref', async () => {
    // The application checks findByAggregatorRef first, but two concurrent
    // webhooks could both pass it. The database is the backstop.
    const order = await placeOrder();
    const ref = `REF-UNIQUE-${Date.now()}`;

    await pool.query(
      `UPDATE transaction SET aggregator = 'sslcommerz', aggregator_ref = $2
        WHERE order_id = $1`,
      [order.orderId, ref],
    );

    await expect(
      pool.query(
        `INSERT INTO transaction (order_id, method, amount_bdt, status,
                                  aggregator, aggregator_ref, is_advance)
         VALUES ($1, 'bkash', '180.00', 'settled', 'sslcommerz', $2, true)`,
        [order.orderId, ref],
      ),
    ).rejects.toThrow(/unique/i);

    await cleanup(order.orderId);
  });

  it('does not stamp a delivery clock for a COD settlement', async () => {
    const codOrder = await orderService.createOrder({
      customerUserId: CUSTOMER,
      merchantRoleId: merchant,
      deliveryLocationId: DHAKA,
      paymentMethod: 'cod',
      lines: [{ listingId: BULB, quantity: 1 }],
      requestedAdvance: 0,
      deliveryFee: 0,
    });

    const result = await paymentService.applySettlement({
      orderId: codOrder.orderId,
      aggregator: 'sslcommerz',
      aggregatorRef: `REF-COD-${Date.now()}`,
      amount: takaToPoisha('180.00'),
      outcome: 'settled',
      occurredAt: new Date(),
    });

    expect(result.status).toBe('applied');

    const row = await pool.query(
      'SELECT status, delivery_deadline_at FROM app_order WHERE id = $1',
      [codOrder.orderId],
    );

    expect(row.rows[0].status).toBe('confirmed');
    // COD settling on delivery must not retroactively create a deadline.
    expect(row.rows[0].delivery_deadline_at).toBeNull();

    await cleanup(codOrder.orderId);
  });
});
