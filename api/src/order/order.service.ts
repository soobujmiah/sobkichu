/**
 * Order creation — the compliance-bearing path.
 *
 * Implements the sequence in docs/architecture/backend-modules.md:
 *   1. resolve the cart against `catalog` (price, stock, ready_to_ship, category)
 *   2. resolve addresses via `location`, determine same-city
 *   3. compute advance_cap_bdt SERVER-SIDE
 *   4. ONE database transaction: order + items + status event + transaction
 *   5. hand off to `payment`
 *
 * Everything that affects money or compliance is recomputed here from
 * server-resolved data. The client supplies listing ids, quantities, an
 * address id and a payment method -- nothing else is trusted.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';

import { Poisha, takaToPoisha, poishaToTaka, sum } from '../common/money';
import {
  CATALOG_PORT,
  CatalogPort,
  RequestedCartLine,
  ResolvedCartLine,
} from '../common/ports/catalog.port';
import { LOCATION_PORT, LocationPort } from '../common/ports/location.port';
import { MERCHANT_PORT, MerchantPort } from '../common/ports/merchant.port';
import { UNIT_OF_WORK, UnitOfWork } from '../common/database/unit-of-work';

import {
  AdvanceCapExceededError,
  assertAdvanceWithinCap,
  cartSubtotal,
  computeAdvanceCap,
  CartLine,
} from './domain/advance-cap';
import { isSameCity } from '../common/compliance/delivery-clock';
import { OrderRepository, NewOrderRecord } from './order.repository';

export type PaymentMethod = 'bkash' | 'nagad' | 'cod' | 'escrow';

export interface CreateOrderCommand {
  readonly customerUserId: string;
  readonly merchantRoleId: string;
  readonly deliveryLocationId: string;
  readonly paymentMethod: PaymentMethod;
  readonly lines: readonly RequestedCartLine[];
  /**
   * Requested advance, in poisha. Validated against the server-computed cap
   * and REJECTED if it exceeds it -- never silently clamped, because a
   * silent clamp hides a merchant misconfiguring ready_to_ship.
   */
  readonly requestedAdvance: Poisha;
  /** Delivery fee in poisha, priced server-side. */
  readonly deliveryFee: Poisha;
}

export interface CreatedOrder {
  readonly orderId: string;
  readonly totalBdt: string;
  readonly advanceCapBdt: string;
  readonly advanceAmountBdt: string;
  readonly isSameCity: boolean;
  /** i18n key explaining which advance-cap branch applied. */
  readonly advanceExplanationKey: string;
}

@Injectable()
export class OrderService {
  constructor(
    @Inject(CATALOG_PORT) private readonly catalog: CatalogPort,
    @Inject(LOCATION_PORT) private readonly locations: LocationPort,
    @Inject(MERCHANT_PORT) private readonly merchants: MerchantPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly orders: OrderRepository,
  ) {}

  async createOrder(command: CreateOrderCommand): Promise<CreatedOrder> {
    if (command.lines.length === 0) {
      throw new BadRequestException('error.checkout.empty_cart');
    }

    // --- 1. Resolve the cart server-side -----------------------------------
    const resolved = await this.catalog.resolveCartLines(command.lines);
    this.assertCartIsOrderable(resolved, command.merchantRoleId);

    // --- 2. Merchant eligibility (compliance K1) ---------------------------
    const merchant = await this.merchants.findMerchant(command.merchantRoleId);
    if (!merchant.isActive) {
      throw new BadRequestException('error.checkout.merchant_unavailable');
    }
    if (!merchant.kycVerified) {
      // NID KYC gates a merchant's ability to transact.
      throw new ForbiddenException('error.checkout.merchant_not_verified');
    }
    if (!merchant.pickupLocationId) {
      throw new BadRequestException('error.checkout.merchant_no_pickup_address');
    }

    // --- 3. Same-city determination (drives the delivery clock, row C4) ----
    const [pickup, delivery] = await Promise.all([
      this.locations.findById(merchant.pickupLocationId),
      this.locations.findById(command.deliveryLocationId),
    ]);
    const sameCity = isSameCity(pickup, delivery);

    // --- 4. Advance cap, computed from server data only (C1/C2/C3) ---------
    const cartLines: CartLine[] = resolved.map((line) => ({
      listingId: line.listingId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      readyToShip: line.readyToShip,
    }));

    const subtotal = cartSubtotal(cartLines);
    const total = sum([subtotal, command.deliveryFee]);

    const cap = computeAdvanceCap({
      lines: cartLines,
      total,
      // Escrow is an admin-configured, Bangladesh Bank-approved provider --
      // never merchant or client self-declaration (compliance row B2).
      isEscrow: command.paymentMethod === 'escrow' && this.escrowEnabled(),
    });

    try {
      assertAdvanceWithinCap(command.requestedAdvance, cap);
    } catch (error) {
      if (error instanceof AdvanceCapExceededError) {
        // Reject, do not clamp. The client renders messageKey.
        throw new BadRequestException(error.messageKey);
      }
      throw error;
    }

    // COD carries no advance by definition.
    if (command.paymentMethod === 'cod' && command.requestedAdvance !== 0) {
      throw new BadRequestException('error.checkout.cod_cannot_have_advance');
    }

    // --- 5. One transaction: order + items + status event + transaction ----
    const record: NewOrderRecord = {
      customerUserId: command.customerUserId,
      merchantRoleId: command.merchantRoleId,
      deliveryLocationId: command.deliveryLocationId,
      paymentMethod: command.paymentMethod,
      subtotalBdt: poishaToTaka(subtotal),
      deliveryFeeBdt: poishaToTaka(command.deliveryFee),
      totalBdt: poishaToTaka(total),
      advanceAmountBdt: poishaToTaka(command.requestedAdvance),
      advanceCapBdt: poishaToTaka(cap.cap),
      isEscrow: cap.reason === 'escrow',
      allItemsReadyToShip: cap.allItemsReadyToShip,
      isSameCity: sameCity,
      items: resolved.map((line) => ({
        listingId: line.listingId,
        quantity: line.quantity,
        unitPriceBdt: poishaToTaka(line.unitPrice),
        // Snapshot the basis of the cap. A live FK to listing.ready_to_ship
        // would let a merchant retroactively change what a past order was
        // allowed to do (ADR-0005).
        readyToShipAtOrder: line.readyToShip,
      })),
    };

    const orderId = await this.uow.withTransaction(async (tx) => {
      const id = await this.orders.insertOrder(tx, record);
      await this.orders.insertItems(tx, id, record.items);
      await this.orders.recordStatusEvent(tx, {
        orderId: id,
        fromStatus: null,
        toStatus: 'created',
        actorRoleId: null,
        noteKey: 'order.event.created',
      });
      await this.orders.insertPendingTransaction(tx, {
        orderId: id,
        method: command.paymentMethod,
        amountBdt: poishaToTaka(
          command.paymentMethod === 'cod' ? total : command.requestedAdvance,
        ),
        isAdvance: command.paymentMethod !== 'cod',
      });
      return id;
    });

    return {
      orderId,
      totalBdt: poishaToTaka(total),
      advanceCapBdt: poishaToTaka(cap.cap),
      advanceAmountBdt: poishaToTaka(command.requestedAdvance),
      isSameCity: sameCity,
      advanceExplanationKey: cap.explanationKey,
    };
  }

  /**
   * Cart-level validation before any money is computed.
   *
   * Phase 1 orders are single-merchant. A multi-merchant cart would need
   * split fulfilment and split delivery clocks, which is Phase 2 work.
   */
  private assertCartIsOrderable(
    lines: readonly ResolvedCartLine[],
    merchantRoleId: string,
  ): void {
    for (const line of lines) {
      if (!line.isActive) {
        throw new BadRequestException('error.checkout.listing_unavailable');
      }
      if (line.categoryRestricted) {
        // Prohibited categories: MLM, lottery/gambling (compliance row C8).
        throw new BadRequestException('error.checkout.category_prohibited');
      }
      if (line.categoryRequiresDgdaLicence) {
        // Medicine/healthcare needs DGDA licensing -- Phase 3, flag off.
        throw new BadRequestException('error.checkout.category_requires_licence');
      }
      if (line.merchantRoleId !== merchantRoleId) {
        throw new BadRequestException('error.checkout.multiple_merchants');
      }
      if (line.stockQty !== null && line.quantity > line.stockQty) {
        throw new BadRequestException('error.checkout.insufficient_stock');
      }
      if (line.quantity < 1) {
        throw new BadRequestException('error.checkout.invalid_quantity');
      }
    }
  }

  /**
   * Whether an approved escrow provider is configured.
   *
   * Placeholder until the provider is selected -- that choice needs legal
   * sign-off (compliance row C3/B2), so it defaults to disabled rather than
   * quietly permitting 100% advances.
   */
  private escrowEnabled(): boolean {
    return process.env.ESCROW_ENABLED === 'true';
  }
}

/** Re-exported so the controller can convert without importing money.ts. */
export { takaToPoisha };
