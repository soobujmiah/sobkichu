/**
 * Money handling tests.
 *
 * These guard the arithmetic underneath the advance-payment cap. Float drift
 * in that path is a compliance problem, not a rounding curiosity.
 */

import {
  takaToPoisha,
  poishaToTaka,
  percentageOf,
  sum,
  multiply,
  MoneyError,
} from './money';

describe('BDT money handling', () => {
  describe('conversion', () => {
    it('converts NUMERIC(12,2) strings to integer poisha', () => {
      expect(takaToPoisha('420.00')).toBe(42000);
      expect(takaToPoisha('0.01')).toBe(1);
      expect(takaToPoisha('0')).toBe(0);
    });

    it('round-trips without loss', () => {
      for (const amount of ['0.00', '0.05', '420.00', '4200.55', '9999.99']) {
        expect(poishaToTaka(takaToPoisha(amount))).toBe(amount);
      }
    });

    it('accepts trailing zeros beyond two decimals', () => {
      // A Postgres NUMERIC driver can legitimately return this form; it
      // loses no precision.
      expect(takaToPoisha('10.9900')).toBe(1099);
    });

    it('rejects sub-poisha precision rather than rounding it', () => {
      // A silent round in a payment path hides a bug upstream.
      expect(() => takaToPoisha('10.999')).toThrow(MoneyError);
      expect(() => takaToPoisha('10.9990')).toThrow(MoneyError);
    });

    it('rejects malformed input', () => {
      for (const bad of ['abc', '', '12.34.56', '১০']) {
        expect(() => takaToPoisha(bad)).toThrow(MoneyError);
      }
    });

    it('handles negative amounts', () => {
      expect(takaToPoisha('-50.25')).toBe(-5025);
      expect(poishaToTaka(-5025)).toBe('-50.25');
    });
  });

  describe('percentageOf', () => {
    it('avoids floating-point drift', () => {
      // 1234.56 * 0.1 in IEEE-754 does not land cleanly; integer poisha does.
      expect(poishaToTaka(percentageOf(takaToPoisha('1234.56'), 10))).toBe('123.45');
    });

    it('rounds DOWN, because it computes a legal maximum', () => {
      // Rounding up could authorise an advance above the permitted ceiling.
      expect(percentageOf(takaToPoisha('0.05'), 10)).toBe(0);
      expect(percentageOf(takaToPoisha('9.99'), 10)).toBe(99); // 99.9 poisha -> 99
    });

    it('handles the boundary percentages', () => {
      const amount = takaToPoisha('100.00');
      expect(percentageOf(amount, 0)).toBe(0);
      expect(percentageOf(amount, 100)).toBe(amount);
    });

    it('rejects an out-of-range percentage', () => {
      expect(() => percentageOf(100, -1)).toThrow(MoneyError);
      expect(() => percentageOf(100, 101)).toThrow(MoneyError);
    });

    it('rejects non-integer poisha', () => {
      expect(() => percentageOf(10.5, 10)).toThrow(MoneyError);
    });
  });

  describe('sum and multiply', () => {
    it('sums integer poisha', () => {
      expect(sum([100, 200, 300])).toBe(600);
      expect(sum([])).toBe(0);
    });

    it('multiplies by a whole quantity', () => {
      expect(poishaToTaka(multiply(takaToPoisha('180.00'), 3))).toBe('540.00');
    });

    it('rejects a zero or fractional quantity', () => {
      expect(() => multiply(100, 0)).toThrow(MoneyError);
      expect(() => multiply(100, 1.5)).toThrow(MoneyError);
    });
  });
});
