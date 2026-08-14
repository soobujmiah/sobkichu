/**
 * Advance-payment cap — Digital Commerce Operation Guidelines 2021.
 *
 * Compliance rows C1, C2, C3 (docs/compliance/compliance-matrix.md).
 *
 * The rule:
 *   Advance payments are capped at 10% of product price, UNLESS
 *     (a) the item is "ready to ship" (deliverable within 72 hours), or
 *     (b) payment runs through a Bangladesh Bank-approved escrow service,
 *   in which case 100% advance is allowed.
 *
 * Two decisions encoded here that are NOT obvious from the rule text, both
 * documented in docs/data-model/extension-rules.md and ADR-0005:
 *
 *  1. MIXED CART -> the 10% cap applies to the WHOLE order. If any line item
 *     is not ready-to-ship, the order is not ready-to-ship. This is the
 *     conservative reading: the alternative (per-line caps summed) would let
 *     a merchant collect 100% on nine ready items and stall on the tenth,
 *     which is the behaviour the guideline exists to prevent. Flagged for
 *     counsel -- if they read it as per-line, only this function changes.
 *
 *  2. REJECT, DON'T CLAMP -> an over-cap request is an error, never silently
 *     reduced. A silent clamp hides a merchant misconfiguring ready_to_ship.
 *
 * This module is PURE: no database, no framework, no I/O. That is what makes
 * it directly testable and is why the cap can be asserted in CI without a
 * running application. The database CHECK constraint is the last line of
 * defence, not the primary mechanism.
 */

import { Poisha, percentageOf, sum } from '../../common/money';

/** DCOG 2021: the standard advance-payment ceiling. */
export const STANDARD_ADVANCE_PERCENT = 10;

/** A single line in the cart, as resolved from the catalog server-side. */
export interface CartLine {
  readonly listingId: string;
  readonly quantity: number;
  /** Unit price in poisha, read from the catalog -- never from the client. */
  readonly unitPrice: Poisha;
  /** Deliverable within 72 hours, per the listing's current state. */
  readonly readyToShip: boolean;
}

export interface AdvanceCapInput {
  readonly lines: readonly CartLine[];
  /** Total order value in poisha, including delivery fee. */
  readonly total: Poisha;
  /**
   * Whether this order is settled through a Bangladesh Bank-approved escrow
   * service. Set from admin-level provider configuration, NEVER from
   * merchant self-declaration (compliance row B2).
   */
  readonly isEscrow: boolean;
}

export type AdvanceCapReason = 'escrow' | 'all_items_ready_to_ship' | 'standard_cap';

export interface AdvanceCapResult {
  /** Maximum permitted advance, in poisha. */
  readonly cap: Poisha;
  /** Which branch of the rule applied -- persisted for auditability. */
  readonly reason: AdvanceCapReason;
  /** Snapshot for app_order.all_items_ready_to_ship. */
  readonly allItemsReadyToShip: boolean;
  /** i18n key explaining the cap to the buyer. Never a hardcoded string. */
  readonly explanationKey: string;
}

/**
 * Compute the maximum advance payment permitted for an order.
 *
 * Uses only server-resolved data. A client-supplied advance amount is
 * validated against this result by `assertAdvanceWithinCap`.
 */
export function computeAdvanceCap(input: AdvanceCapInput): AdvanceCapResult {
  const { lines, total, isEscrow } = input;

  if (lines.length === 0) {
    throw new Error('Cannot compute an advance cap for an empty cart');
  }

  // Mixed cart: every line must be ready-to-ship for the order to qualify.
  const allItemsReadyToShip = lines.every((line) => line.readyToShip);

  if (isEscrow) {
    return {
      cap: total,
      reason: 'escrow',
      allItemsReadyToShip,
      explanationKey: 'checkout.advance.escrow_full_allowed',
    };
  }

  if (allItemsReadyToShip) {
    return {
      cap: total,
      reason: 'all_items_ready_to_ship',
      allItemsReadyToShip,
      explanationKey: 'checkout.advance.ready_to_ship_full_allowed',
    };
  }

  return {
    cap: percentageOf(total, STANDARD_ADVANCE_PERCENT),
    reason: 'standard_cap',
    allItemsReadyToShip,
    explanationKey: 'checkout.advance.capped_at_ten_percent',
  };
}

/** Thrown when a requested advance exceeds the permitted cap. */
export class AdvanceCapExceededError extends Error {
  /** i18n key for the user-facing message. Never a hardcoded string. */
  readonly messageKey = 'error.checkout.advance_exceeds_cap';

  constructor(
    readonly requested: Poisha,
    readonly cap: Poisha,
    readonly reason: AdvanceCapReason,
  ) {
    // Developer-facing only; the client renders messageKey.
    super(`Advance ${requested} poisha exceeds cap ${cap} poisha (${reason})`);
    this.name = 'AdvanceCapExceededError';
  }
}

/**
 * Validate a requested advance against the computed cap.
 *
 * Rejects rather than clamping -- see the note at the top of this file.
 */
export function assertAdvanceWithinCap(
  requested: Poisha,
  result: AdvanceCapResult,
): void {
  if (!Number.isInteger(requested) || requested < 0) {
    throw new Error(`Requested advance must be non-negative poisha, got ${requested}`);
  }
  if (requested > result.cap) {
    throw new AdvanceCapExceededError(requested, result.cap, result.reason);
  }
}

/** Order subtotal from resolved cart lines, in poisha. */
export function cartSubtotal(lines: readonly CartLine[]): Poisha {
  return sum(lines.map((line) => line.unitPrice * line.quantity));
}
