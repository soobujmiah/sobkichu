/**
 * Catalog port — the interface `order` calls instead of touching the
 * `listing` table directly.
 *
 * Boundary rule 1 (docs/architecture/backend-modules.md): no cross-module
 * database access. `catalog` owns `listing` and `category`; every other
 * module goes through this contract.
 *
 * Ports live in `common/` so that neither module imports the other. That is
 * also what keeps the ESLint no-restricted-imports rule satisfiable without
 * exceptions -- and what makes a later service extraction a move, not a
 * rewrite (ADR-0002).
 */

import { Poisha } from '../money';

/** Injection token — `common` must not import the implementation. */
export const CATALOG_PORT = Symbol('CATALOG_PORT');

/**
 * A cart line resolved against the catalog.
 *
 * Every field here is SERVER-RESOLVED. The client sends a listing id and a
 * quantity; it never sends a price, and it never sends ready_to_ship. Both
 * feed the advance-payment cap, so a client-supplied value would let a buyer
 * or a compromised app choose its own legal ceiling.
 */
export interface ResolvedCartLine {
  readonly listingId: string;
  readonly quantity: number;
  /** Current catalog price, in poisha. */
  readonly unitPrice: Poisha;
  /** Deliverable within 72 hours (DCOG 2021, compliance row C2). */
  readonly readyToShip: boolean;
  /** Owning merchant Role id — used to check single-merchant orders. */
  readonly merchantRoleId: string;
  /** True when the category is prohibited (MLM, lottery/gambling — row C8). */
  readonly categoryRestricted: boolean;
  /** True when the category needs DGDA licensing (Phase 3 — row C9). */
  readonly categoryRequiresDgdaLicence: boolean;
  /** Remaining stock; null for service slots. */
  readonly stockQty: number | null;
  readonly isActive: boolean;
}

/** A line as requested by the client: identifiers and quantity only. */
export interface RequestedCartLine {
  readonly listingId: string;
  readonly quantity: number;
}

export interface CatalogPort {
  /**
   * Resolve requested lines against current catalog state.
   *
   * Throws if any listing id does not exist. Returns lines in the same order
   * as requested.
   */
  resolveCartLines(lines: readonly RequestedCartLine[]): Promise<ResolvedCartLine[]>;
}
