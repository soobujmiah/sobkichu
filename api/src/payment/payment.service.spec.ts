/**
 * Payment settlement — compliance regression tests.
 *
 * Covers the two things that must not break:
 *   - idempotency, because aggregators retry (master prompt Section 8)
 *   - the delivery clock starting at ADVANCE PAYMENT (compliance C4)
 *
 * A failure here is a COMPLIANCE REGRESSION, not a flaky test.
 */

import { TransactionContext, UnitOfWork } from '../common/database/unit-of-work';
import { NotificationPort, NotificationRequest } from '../common/ports/notification.port';
import { OrderCustomer, OrderForSettlement, OrderPort } from '../common/ports/order.port';

import { PaymentRepository, TransactionRow } from './payment.repository';
import { PaymentService, SettlementNotice } from './payment.service';

const ORDER_ID = '99999999-9999-4999-8999-000000000001';

const txRow = (overrides: Partial<TransactionRow> = {}): TransactionRow => ({
  id: 'txn-1',
  order_id: ORDER_ID,
  method: 'bkash',
  amount_bdt: '420.00',
  status: 'pending',
  aggregator: null,
  aggregator_ref: null,
  is_advance: true,
  settled_at: null,
  ...overrides,
});

class FakeUnitOfWork implements UnitOfWork {
  transactions = 0;
  rolledBack = false;

  async withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const tx: TransactionContext = { query: async () => [] };
    try {
      return await work(tx);
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
  }
}

class FakeOrderPort implements OrderPort {
  transitions: Array<{ to: string; noteKey: string }> = [];
  clockStarts: Array<{ paidAt: Date; deadline: Date }> = [];

  constructor(private readonly order: OrderForSettlement | null) {}

  async findForSettlement() {
    return this.order;
  }

  async findCustomer(): Promise<OrderCustomer | null> {
    return this.order ? { customerUserId: 'customer-1' } : null;
  }

  async transitionStatus(
    _tx: TransactionContext,
    _orderId: string,
    toStatus: string,
    noteKey: string,
  ) {
    this.transitions.push({ to: toStatus, noteKey });
  }

  async startDeliveryClock(
    _tx: TransactionContext,
    _orderId: string,
    advancePaidAt: Date,
    deadlineAt: Date,
  ) {
    this.clockStarts.push({ paidAt: advancePaidAt, deadline: deadlineAt });
  }
}

class FakePaymentRepository extends PaymentRepository {
  settled: string[] = [];
  failed: string[] = [];

  constructor(
    private readonly byRef: TransactionRow | null,
    private readonly pending: TransactionRow | null,
  ) {
    super();
  }

  override async findByAggregatorRef() {
    return this.byRef;
  }

  override async findPendingForOrder() {
    return this.pending;
  }

  override async markSettled(
    _tx: TransactionContext,
    transactionId: string,
  ): Promise<void> {
    this.settled.push(transactionId);
  }

  override async markFailed(
    _tx: TransactionContext,
    transactionId: string,
  ): Promise<void> {
    this.failed.push(transactionId);
  }
}

class RecordingNotifications implements NotificationPort {
  queued: NotificationRequest[] = [];

  async enqueue(_tx: TransactionContext, request: NotificationRequest) {
    this.queued.push(request);
  }
}

const notice = (overrides: Partial<SettlementNotice> = {}): SettlementNotice => ({
  orderId: ORDER_ID,
  aggregator: 'sslcommerz',
  aggregatorRef: 'REF-1',
  amount: 42000, // 420.00 in poisha
  outcome: 'settled',
  occurredAt: new Date('2026-08-14T10:00:00Z'),
  ...overrides,
});

function harness(options: {
  byRef?: TransactionRow | null;
  pending?: TransactionRow | null;
  order?: OrderForSettlement | null;
}) {
  const repo = new FakePaymentRepository(
    options.byRef ?? null,
    options.pending === undefined ? txRow() : options.pending,
  );
  const orders = new FakeOrderPort(
    options.order === undefined
      ? { orderId: ORDER_ID, isSameCity: true, advancePaidAt: null, status: 'created' }
      : options.order,
  );
  const uow = new FakeUnitOfWork();
  const notifications = new RecordingNotifications();
  return {
    service: new PaymentService(uow, orders, notifications, repo),
    repo,
    orders,
    uow,
    notifications,
  };
}

describe('PaymentService.applySettlement', () => {
  describe('idempotency (aggregators retry)', () => {
    it('ignores a webhook whose aggregator_ref was already applied', async () => {
      const { service, repo, orders } = harness({
        byRef: txRow({ status: 'settled', aggregator_ref: 'REF-1' }),
      });

      const result = await service.applySettlement(notice());

      expect(result).toEqual({ status: 'duplicate', orderId: ORDER_ID });
      // Crucially: no second settlement, no second status change.
      expect(repo.settled).toHaveLength(0);
      expect(orders.transitions).toHaveLength(0);
      expect(orders.clockStarts).toHaveLength(0);
    });

    it('applies the first delivery of the same webhook', async () => {
      const { service, repo } = harness({ byRef: null });

      const result = await service.applySettlement(notice());

      expect(result.status).toBe('applied');
      expect(repo.settled).toEqual(['txn-1']);
    });
  });

  describe('amount verification', () => {
    it('rejects a settlement whose amount does not match our record', async () => {
      // The aggregator is an external system; its payload is untrusted.
      const { service, repo, orders } = harness({});

      const result = await service.applySettlement(notice({ amount: 999999 }));

      expect(result).toEqual({ status: 'rejected', reason: 'amount_mismatch' });
      expect(repo.settled).toHaveLength(0);
      expect(orders.transitions).toHaveLength(0);
    });

    it('rejects when there is no pending transaction to settle', async () => {
      const { service } = harness({ pending: null });

      const result = await service.applySettlement(notice());

      expect(result).toEqual({ status: 'rejected', reason: 'no_pending_transaction' });
    });
  });

  describe('C4 — the delivery clock starts at advance payment', () => {
    it('stamps a 5-day deadline for a same-city advance', async () => {
      const { service, orders } = harness({
        order: {
          orderId: ORDER_ID,
          isSameCity: true,
          advancePaidAt: null,
          status: 'created',
        },
      });

      const result = await service.applySettlement(notice());

      expect(orders.clockStarts).toHaveLength(1);
      expect(orders.clockStarts[0].deadline.toISOString()).toBe(
        '2026-08-19T10:00:00.000Z',
      );
      expect(
        result.status === 'applied' && result.deliveryDeadlineAt?.toISOString(),
      ).toBe('2026-08-19T10:00:00.000Z');
    });

    it('stamps a 10-day deadline for a different-city advance', async () => {
      const { service, orders } = harness({
        order: {
          orderId: ORDER_ID,
          isSameCity: false,
          advancePaidAt: null,
          status: 'created',
        },
      });

      await service.applySettlement(notice());

      expect(orders.clockStarts[0].deadline.toISOString()).toBe(
        '2026-08-24T10:00:00.000Z',
      );
    });

    it('measures from the settlement time, not from now', async () => {
      const { service, orders } = harness({});

      await service.applySettlement(
        notice({ occurredAt: new Date('2026-09-01T06:30:00Z') }),
      );

      expect(orders.clockStarts[0].paidAt.toISOString()).toBe('2026-09-01T06:30:00.000Z');
      expect(orders.clockStarts[0].deadline.toISOString()).toBe(
        '2026-09-06T06:30:00.000Z',
      );
    });

    it('does NOT stamp a clock for a non-advance (COD) settlement', async () => {
      // A COD payment settling on delivery must not retroactively create a
      // delivery deadline.
      const { service, orders } = harness({
        pending: txRow({ method: 'cod', is_advance: false }),
      });

      const result = await service.applySettlement(notice());

      expect(result).toEqual({
        status: 'applied',
        orderId: ORDER_ID,
        deliveryDeadlineAt: null,
      });
      expect(orders.clockStarts).toHaveLength(0);
      // The order is still confirmed, just without a regulated deadline.
      expect(orders.transitions[0].to).toBe('confirmed');
    });

    it('does NOT restart a clock that has already been stamped', async () => {
      // Restarting would silently extend a regulated deadline.
      const { service, orders } = harness({
        order: {
          orderId: ORDER_ID,
          isSameCity: true,
          advancePaidAt: new Date('2026-08-01T00:00:00Z'),
          status: 'confirmed',
        },
      });

      await service.applySettlement(notice());

      expect(orders.clockStarts).toHaveLength(0);
    });
  });

  describe('order status', () => {
    it('confirms the order on a successful settlement', async () => {
      const { service, orders } = harness({});

      await service.applySettlement(notice());

      expect(orders.transitions).toEqual([
        { to: 'confirmed', noteKey: 'order.event.payment_received' },
      ]);
    });

    it('returns the order to awaiting_payment on failure', async () => {
      const { service, repo, orders } = harness({});

      const result = await service.applySettlement(notice({ outcome: 'failed' }));

      expect(result.status).toBe('applied');
      expect(repo.failed).toEqual(['txn-1']);
      expect(orders.transitions).toEqual([
        { to: 'awaiting_payment', noteKey: 'order.event.payment_failed' },
      ]);
      expect(orders.clockStarts).toHaveLength(0);
    });

    it('uses i18n keys for every status note, never English text', async () => {
      const { service, orders } = harness({});

      await service.applySettlement(notice());

      for (const transition of orders.transitions) {
        expect(transition.noteKey).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      }
    });
  });

  describe('notifications (Section 8: SMS is mandatory)', () => {
    it('queues a payment_received notification on settlement', async () => {
      const { service, notifications } = harness({});

      await service.applySettlement(notice());

      expect(notifications.queued).toHaveLength(1);
      expect(notifications.queued[0].event).toBe('payment_received');
      expect(notifications.queued[0].params.amount).toBe('420.00');
    });

    it('queues a payment_failed notification on failure', async () => {
      const { service, notifications } = harness({});

      await service.applySettlement(notice({ outcome: 'failed' }));

      expect(notifications.queued[0].event).toBe('payment_failed');
    });

    it('derives the dedupe key from the aggregator ref, not the clock', async () => {
      // A replayed webhook must map to the same key so the outbox UNIQUE
      // constraint collapses it into one notification.
      const { service, notifications } = harness({});

      await service.applySettlement(notice({ aggregatorRef: 'REF-XYZ' }));

      expect(notifications.queued[0].dedupeKey).toBe(
        'settle:sslcommerz:REF-XYZ:payment_received',
      );
    });

    it('queues NOTHING for a duplicate webhook', async () => {
      const { service, notifications } = harness({
        byRef: txRow({ status: 'settled', aggregator_ref: 'REF-1' }),
      });

      await service.applySettlement(notice());

      expect(notifications.queued).toEqual([]);
    });

    it('queues nothing when the settlement is rejected', async () => {
      const { service, notifications } = harness({});

      await service.applySettlement(notice({ amount: 999999 }));

      expect(notifications.queued).toEqual([]);
    });
  });

  describe('atomicity', () => {
    it('does all of it inside ONE transaction', async () => {
      const { service, uow } = harness({});

      await service.applySettlement(notice());

      // Settlement + status change + clock stamp cannot be split across
      // commits, or a crash between them leaves a paid order unconfirmed.
      expect(uow.transactions).toBe(1);
      expect(uow.rolledBack).toBe(false);
    });
  });
});
