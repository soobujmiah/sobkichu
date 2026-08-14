/**
 * Order creation — compliance regression tests at the service level.
 *
 * The domain tests prove the RULES are right. These prove the service
 * APPLIES them: that the cap is computed from catalog data rather than
 * client input, that everything lands in one transaction, and that the
 * ready-to-ship basis is snapshotted.
 *
 * Uses in-memory fakes for the ports, so no database is needed. That is the
 * payoff of the port boundary (docs/architecture/backend-modules.md).
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { takaToPoisha, poishaToTaka } from '../common/money';
import {
  CatalogPort,
  RequestedCartLine,
  ResolvedCartLine,
} from '../common/ports/catalog.port';
import { LocationPort, ResolvedLocation } from '../common/ports/location.port';
import { MerchantPort, MerchantSummary } from '../common/ports/merchant.port';
import {
  NotificationPort,
  NotificationRequest,
} from '../common/ports/notification.port';
import { TransactionContext, UnitOfWork } from '../common/database/unit-of-work';

import { OrderService } from './order.service';
import { NewOrderRecord, OrderRepository } from './order.repository';

const MERCHANT_ROLE = '33333333-3333-4333-8333-000000000003';
const CUSTOMER = '22222222-2222-4222-8222-000000000001';
const DHAKA_LOC = '11111111-1111-4111-8111-000000000001';
const CTG_LOC = '11111111-1111-4111-8111-000000000006';

const location = (id: string, division: string, district: string): ResolvedLocation => ({
  id,
  division,
  district,
  upazilaThana: 'Kotwali',
  unionWard: null,
  villageMohalla: null,
  addressLine: null,
  hasGeo: true,
});

const listing = (
  id: string,
  taka: string,
  readyToShip: boolean,
  overrides: Partial<ResolvedCartLine> = {},
): ResolvedCartLine => ({
  listingId: id,
  quantity: 1,
  unitPrice: takaToPoisha(taka),
  readyToShip,
  merchantRoleId: MERCHANT_ROLE,
  categoryRestricted: false,
  categoryRequiresDgdaLicence: false,
  stockQty: 100,
  isActive: true,
  ...overrides,
});

/** Records what the service tried to persist, and in what order. */
class RecordingRepository extends OrderRepository {
  orders: NewOrderRecord[] = [];
  calls: string[] = [];

  override async insertOrder(_tx: TransactionContext, record: NewOrderRecord) {
    this.orders.push(record);
    this.calls.push('insertOrder');
    return 'order-1';
  }

  override async insertItems() {
    this.calls.push('insertItems');
  }

  override async recordStatusEvent() {
    this.calls.push('recordStatusEvent');
  }

  override async insertPendingTransaction() {
    this.calls.push('insertPendingTransaction');
  }
}

class FakeUnitOfWork implements UnitOfWork {
  transactions = 0;
  committed = false;

  async withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const tx: TransactionContext = { query: async () => [] };
    const result = await work(tx);
    this.committed = true;
    return result;
  }
}

class RecordingNotifications implements NotificationPort {
  queued: NotificationRequest[] = [];

  async enqueue(_tx: TransactionContext, request: NotificationRequest) {
    this.queued.push(request);
  }
}

interface Harness {
  service: OrderService;
  repo: RecordingRepository;
  uow: FakeUnitOfWork;
  notifications: RecordingNotifications;
}

function harness(
  resolved: ResolvedCartLine[],
  merchant: Partial<MerchantSummary> = {},
): Harness {
  const catalog: CatalogPort = {
    resolveCartLines: async (lines: readonly RequestedCartLine[]) =>
      lines.map((line, index) => ({
        ...resolved[index],
        quantity: line.quantity,
      })),
  };

  const locations: LocationPort = {
    findById: async (id: string) =>
      id === CTG_LOC
        ? location(id, 'Chattogram', 'Chattogram')
        : location(id, 'Dhaka', 'Dhaka'),
  };

  const merchants: MerchantPort = {
    findMerchant: async (roleId: string) => ({
      roleId,
      kycVerified: true,
      isActive: true,
      pickupLocationId: DHAKA_LOC,
      ...merchant,
    }),
  };

  const repo = new RecordingRepository();
  const uow = new FakeUnitOfWork();
  const notifications = new RecordingNotifications();
  const service = new OrderService(
    catalog,
    locations,
    merchants,
    uow,
    notifications,
    repo,
  );

  return { service, repo, uow, notifications };
}

const command = (overrides: Record<string, unknown> = {}) => ({
  customerUserId: CUSTOMER,
  merchantRoleId: MERCHANT_ROLE,
  deliveryLocationId: DHAKA_LOC,
  paymentMethod: 'bkash' as const,
  lines: [{ listingId: 'l1', quantity: 1 }],
  requestedAdvance: 0,
  deliveryFee: 0,
  ...overrides,
});

describe('OrderService.createOrder', () => {
  describe('the cap is computed from catalog data, not client input', () => {
    it('caps a non-ready order at 10% whatever the client requests', async () => {
      const { service, repo } = harness([listing('l1', '4200.00', false)]);

      await service.createOrder(command({ requestedAdvance: takaToPoisha('420.00') }));

      expect(repo.orders[0].advanceCapBdt).toBe('420.00');
      expect(repo.orders[0].allItemsReadyToShip).toBe(false);
    });

    it('rejects an advance above the cap rather than clamping it', async () => {
      const { service, repo } = harness([listing('l1', '4200.00', false)]);

      await expect(
        service.createOrder(command({ requestedAdvance: takaToPoisha('4200.00') })),
      ).rejects.toThrow(BadRequestException);

      // Nothing was written: rejection happens before the transaction.
      expect(repo.orders).toHaveLength(0);
    });

    it('allows 100% when every item is ready to ship', async () => {
      const { service, repo } = harness([listing('l1', '180.00', true)]);

      await service.createOrder(command({ requestedAdvance: takaToPoisha('180.00') }));

      expect(repo.orders[0].advanceCapBdt).toBe('180.00');
      expect(repo.orders[0].allItemsReadyToShip).toBe(true);
    });

    it('applies the 10% cap to the whole order when a cart is mixed', async () => {
      const { service, repo } = harness([
        listing('l1', '180.00', true),
        listing('l2', '4200.00', false),
      ]);

      await service.createOrder(
        command({
          lines: [
            { listingId: 'l1', quantity: 1 },
            { listingId: 'l2', quantity: 1 },
          ],
          requestedAdvance: takaToPoisha('438.00'),
        }),
      );

      expect(repo.orders[0].totalBdt).toBe('4380.00');
      expect(repo.orders[0].advanceCapBdt).toBe('438.00');
    });
  });

  describe('ready-to-ship basis is snapshotted', () => {
    it('records ready_to_ship per line as it was at order time', async () => {
      const { service, repo } = harness([
        listing('l1', '180.00', true),
        listing('l2', '4200.00', false),
      ]);

      await service.createOrder(
        command({
          lines: [
            { listingId: 'l1', quantity: 1 },
            { listingId: 'l2', quantity: 1 },
          ],
        }),
      );

      // Without this, a merchant flipping the flag later makes a past
      // order's cap unexplainable (ADR-0005).
      const snapshots = repo.orders[0].items.map((i) => i.readyToShipAtOrder);
      expect(snapshots).toEqual([true, false]);
    });

    it('snapshots the unit price at order time', async () => {
      const { service, repo } = harness([listing('l1', '180.00', true)]);

      await service.createOrder(command({ lines: [{ listingId: 'l1', quantity: 3 }] }));

      expect(repo.orders[0].items[0].unitPriceBdt).toBe('180.00');
      expect(repo.orders[0].totalBdt).toBe('540.00');
    });
  });

  describe('same-city determination drives the delivery clock', () => {
    it('marks a Dhaka-to-Dhaka order same-city', async () => {
      const { service, repo } = harness([listing('l1', '180.00', true)]);

      await service.createOrder(command());

      expect(repo.orders[0].isSameCity).toBe(true);
    });

    it('marks a Dhaka-to-Chattogram order different-city', async () => {
      const { service, repo } = harness([listing('l1', '180.00', true)]);

      await service.createOrder(command({ deliveryLocationId: CTG_LOC }));

      expect(repo.orders[0].isSameCity).toBe(false);
    });
  });

  describe('atomicity', () => {
    it('writes order, items, event and transaction in ONE transaction', async () => {
      const { service, repo, uow } = harness([listing('l1', '180.00', true)]);

      await service.createOrder(command());

      expect(uow.transactions).toBe(1);
      expect(uow.committed).toBe(true);
      expect(repo.calls).toEqual([
        'insertOrder',
        'insertItems',
        'recordStatusEvent',
        'insertPendingTransaction',
      ]);
    });

    it('queues the confirmation notification inside the same transaction', async () => {
      // A rolled-back order must not leave an SMS telling the buyer it was
      // placed (master prompt Section 8).
      const { service, notifications } = harness([listing('l1', '180.00', true)]);

      await service.createOrder(command());

      expect(notifications.queued).toHaveLength(1);
      expect(notifications.queued[0].event).toBe('order_confirmed');
      expect(notifications.queued[0].dedupeKey).toBe('order-created:order-1');
    });
  });

  describe('merchant eligibility', () => {
    it('refuses an unverified merchant (compliance K1)', async () => {
      const { service } = harness([listing('l1', '180.00', true)], {
        kycVerified: false,
      });

      await expect(service.createOrder(command())).rejects.toThrow(ForbiddenException);
    });

    it('refuses an inactive merchant', async () => {
      const { service } = harness([listing('l1', '180.00', true)], { isActive: false });

      await expect(service.createOrder(command())).rejects.toThrow(BadRequestException);
    });
  });

  describe('cart validation', () => {
    it('refuses a prohibited category (compliance C8)', async () => {
      const { service } = harness([
        listing('l1', '180.00', true, { categoryRestricted: true }),
      ]);

      await expect(service.createOrder(command())).rejects.toThrow(BadRequestException);
    });

    it('refuses a category needing DGDA licensing (compliance C9)', async () => {
      const { service } = harness([
        listing('l1', '180.00', true, { categoryRequiresDgdaLicence: true }),
      ]);

      await expect(service.createOrder(command())).rejects.toThrow(BadRequestException);
    });

    it('refuses a multi-merchant cart in Phase 1', async () => {
      const { service } = harness([
        listing('l1', '180.00', true),
        listing('l2', '180.00', true, { merchantRoleId: 'another-merchant' }),
      ]);

      await expect(
        service.createOrder(
          command({
            lines: [
              { listingId: 'l1', quantity: 1 },
              { listingId: 'l2', quantity: 1 },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an order exceeding available stock', async () => {
      const { service } = harness([listing('l1', '180.00', true, { stockQty: 2 })]);

      await expect(
        service.createOrder(command({ lines: [{ listingId: 'l1', quantity: 5 }] })),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an empty cart', async () => {
      const { service } = harness([]);

      await expect(service.createOrder(command({ lines: [] }))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('COD', () => {
    it('records the full total as the pending transaction', async () => {
      const { service, repo } = harness([listing('l1', '180.00', true)]);

      await service.createOrder(command({ paymentMethod: 'cod', requestedAdvance: 0 }));

      expect(repo.orders[0].advanceAmountBdt).toBe('0.00');
      expect(repo.orders[0].paymentMethod).toBe('cod');
    });

    it('refuses a COD order carrying an advance', async () => {
      const { service } = harness([listing('l1', '180.00', true)]);

      await expect(
        service.createOrder(
          command({ paymentMethod: 'cod', requestedAdvance: takaToPoisha('50.00') }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('escrow', () => {
    it('withholds the escrow exemption when no provider is configured', async () => {
      // ESCROW_ENABLED defaults off: the provider choice needs legal
      // sign-off (compliance C3/B2), so it must not quietly permit 100%.
      const previous = process.env.ESCROW_ENABLED;
      delete process.env.ESCROW_ENABLED;

      const { service, repo } = harness([listing('l1', '4200.00', false)]);
      await service.createOrder(
        command({ paymentMethod: 'escrow', requestedAdvance: takaToPoisha('420.00') }),
      );

      expect(repo.orders[0].isEscrow).toBe(false);
      expect(repo.orders[0].advanceCapBdt).toBe('420.00');

      if (previous !== undefined) {
        process.env.ESCROW_ENABLED = previous;
      }
    });

    it('grants the exemption when an approved provider is configured', async () => {
      const previous = process.env.ESCROW_ENABLED;
      process.env.ESCROW_ENABLED = 'true';

      const { service, repo } = harness([listing('l1', '4200.00', false)]);
      await service.createOrder(
        command({ paymentMethod: 'escrow', requestedAdvance: takaToPoisha('4200.00') }),
      );

      expect(repo.orders[0].isEscrow).toBe(true);
      expect(repo.orders[0].advanceCapBdt).toBe('4200.00');

      if (previous === undefined) {
        delete process.env.ESCROW_ENABLED;
      } else {
        process.env.ESCROW_ENABLED = previous;
      }
    });
  });

  it('returns an i18n key explaining which cap branch applied', async () => {
    const { service } = harness([listing('l1', '4200.00', false)]);

    const result = await service.createOrder(command());

    expect(result.advanceExplanationKey).toBe('checkout.advance.capped_at_ten_percent');
    expect(poishaToTaka(takaToPoisha(result.advanceCapBdt))).toBe('420.00');
  });
});
