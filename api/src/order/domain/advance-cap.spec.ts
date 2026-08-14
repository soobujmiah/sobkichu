/**
 * Compliance regression tests — advance-payment cap.
 *
 * These encode legal obligations (DCOG 2021, rows C1/C2/C3 in
 * docs/compliance/compliance-matrix.md). A failure here is a COMPLIANCE
 * REGRESSION, not a flaky test. It does not get a `skip`.
 *
 * Mirrors the schema-level assertions in tools/schema_assertions.sql: the
 * database CHECK constraint is the last line of defence, this is the
 * primary mechanism (ADR-0005).
 */

import { takaToPoisha, poishaToTaka } from '../../common/money';
import {
  CartLine,
  computeAdvanceCap,
  assertAdvanceWithinCap,
  cartSubtotal,
  AdvanceCapExceededError,
  STANDARD_ADVANCE_PERCENT,
} from './advance-cap';

const line = (taka: string, readyToShip: boolean, quantity = 1): CartLine => ({
  listingId: `listing-${taka}`,
  quantity,
  unitPrice: takaToPoisha(taka),
  readyToShip,
});

describe('advance-payment cap (DCOG 2021)', () => {
  it('caps the standard advance at 10 percent', () => {
    expect(STANDARD_ADVANCE_PERCENT).toBe(10);
  });

  describe('C1 — standard cap, item not ready to ship', () => {
    it('permits only 10% of the total', () => {
      const lines = [line('4200.00', false)];
      const result = computeAdvanceCap({
        lines,
        total: cartSubtotal(lines),
        isEscrow: false,
      });

      expect(poishaToTaka(result.cap)).toBe('420.00');
      expect(result.reason).toBe('standard_cap');
      expect(result.allItemsReadyToShip).toBe(false);
    });

    it('rounds the cap DOWN, never up', () => {
      // 10% of 1234.56 is 123.456 -- rounding up would authorise an advance
      // fractionally above the legal ceiling.
      const lines = [line('1234.56', false)];
      const result = computeAdvanceCap({
        lines,
        total: cartSubtotal(lines),
        isEscrow: false,
      });

      expect(poishaToTaka(result.cap)).toBe('123.45');
    });
  });

  describe('C2 — ready to ship', () => {
    it('permits 100% advance when every item is ready to ship', () => {
      const lines = [line('180.00', true), line('360.00', true)];
      const result = computeAdvanceCap({
        lines,
        total: cartSubtotal(lines),
        isEscrow: false,
      });

      expect(poishaToTaka(result.cap)).toBe('540.00');
      expect(result.reason).toBe('all_items_ready_to_ship');
      expect(result.allItemsReadyToShip).toBe(true);
    });
  });

  describe('C3 — Bangladesh Bank-approved escrow', () => {
    it('permits 100% advance even when items are not ready to ship', () => {
      const lines = [line('4200.00', false)];
      const result = computeAdvanceCap({
        lines,
        total: cartSubtotal(lines),
        isEscrow: true,
      });

      expect(poishaToTaka(result.cap)).toBe('4200.00');
      expect(result.reason).toBe('escrow');
    });

    it('still records that items were not ready to ship, for audit', () => {
      const lines = [line('4200.00', false)];
      const result = computeAdvanceCap({
        lines,
        total: cartSubtotal(lines),
        isEscrow: true,
      });

      // The escrow branch must not overwrite the ready-to-ship evidence:
      // app_order.all_items_ready_to_ship records what was actually true.
      expect(result.allItemsReadyToShip).toBe(false);
    });
  });

  describe('mixed cart', () => {
    // Documented judgement call: the conservative reading of DCOG 2021.
    // If counsel reads the rule as per-line, only computeAdvanceCap changes.
    it('applies the 10% cap to the WHOLE order if any item is not ready', () => {
      const lines = [line('180.00', true), line('180.00', true), line('4200.00', false)];
      const total = cartSubtotal(lines);
      expect(poishaToTaka(total)).toBe('4560.00');

      const result = computeAdvanceCap({ lines, total, isEscrow: false });

      // Conservative: 10% of everything.
      expect(poishaToTaka(result.cap)).toBe('456.00');
      // A per-line reading would have allowed 180 + 180 + 420 = 780.00.
      expect(poishaToTaka(result.cap)).not.toBe('780.00');
      expect(result.allItemsReadyToShip).toBe(false);
    });
  });

  describe('reject, do not clamp', () => {
    const lines = [line('4200.00', false)];
    const result = computeAdvanceCap({
      lines,
      total: cartSubtotal(lines),
      isEscrow: false,
    });

    it('throws when the requested advance exceeds the cap', () => {
      expect(() => assertAdvanceWithinCap(takaToPoisha('4200.00'), result)).toThrow(
        AdvanceCapExceededError,
      );
    });

    it('does not silently reduce the amount', () => {
      // A silent clamp would hide a merchant misconfiguring ready_to_ship.
      let thrown: AdvanceCapExceededError | undefined;
      try {
        assertAdvanceWithinCap(takaToPoisha('4200.00'), result);
      } catch (error) {
        thrown = error as AdvanceCapExceededError;
      }

      expect(thrown).toBeDefined();
      expect(poishaToTaka(thrown!.requested)).toBe('4200.00');
      expect(poishaToTaka(thrown!.cap)).toBe('420.00');
    });

    it('carries an i18n key, not a hardcoded English message', () => {
      try {
        assertAdvanceWithinCap(takaToPoisha('4200.00'), result);
        fail('expected AdvanceCapExceededError');
      } catch (error) {
        expect((error as AdvanceCapExceededError).messageKey).toBe(
          'error.checkout.advance_exceeds_cap',
        );
      }
    });

    it('allows an advance exactly at the cap', () => {
      expect(() => assertAdvanceWithinCap(takaToPoisha('420.00'), result)).not.toThrow();
    });

    it('allows an advance below the cap', () => {
      expect(() => assertAdvanceWithinCap(takaToPoisha('100.00'), result)).not.toThrow();
    });

    it('rejects a negative advance', () => {
      expect(() => assertAdvanceWithinCap(-1, result)).toThrow();
    });
  });

  describe('input validation', () => {
    it('refuses to compute a cap for an empty cart', () => {
      expect(() => computeAdvanceCap({ lines: [], total: 0, isEscrow: false })).toThrow();
    });

    it('accounts for quantity in the subtotal', () => {
      expect(poishaToTaka(cartSubtotal([line('180.00', true, 3)]))).toBe('540.00');
    });
  });
});
