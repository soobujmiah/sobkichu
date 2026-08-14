/**
 * Compliance regression tests — delivery clock.
 *
 * DCOG 2021, rows C4/C5 in docs/compliance/compliance-matrix.md.
 * A failure here is a COMPLIANCE REGRESSION, not a flaky test.
 */

import {
  isSameCity,
  deliveryWindowDays,
  computeDeliveryDeadline,
  isOverdue,
  daysRemaining,
  SAME_CITY_DELIVERY_DAYS,
  DIFFERENT_CITY_DELIVERY_DAYS,
} from './delivery-clock';

const DHAKA = { division: 'Dhaka', district: 'Dhaka' };
const CHATTOGRAM = { division: 'Chattogram', district: 'Chattogram' };

describe('delivery clock (DCOG 2021)', () => {
  it('uses the regulated windows', () => {
    expect(SAME_CITY_DELIVERY_DAYS).toBe(5);
    expect(DIFFERENT_CITY_DELIVERY_DAYS).toBe(10);
  });

  describe('same-city determination', () => {
    it('matches on district within the same division', () => {
      expect(isSameCity(DHAKA, DHAKA)).toBe(true);
    });

    it('treats a different district as a different city', () => {
      expect(isSameCity(DHAKA, CHATTOGRAM)).toBe(false);
    });

    it('normalises case and whitespace', () => {
      expect(isSameCity({ division: ' dhaka ', district: 'DHAKA' }, DHAKA)).toBe(true);
    });

    it('qualifies district by division', () => {
      // District names are not globally unique across divisions in
      // Bangladesh. Matching district alone would occasionally produce a
      // false "same city" and understate the legal delivery window.
      expect(
        isSameCity(
          { division: 'Dhaka', district: 'Narsingdi' },
          { division: 'Sylhet', district: 'Narsingdi' },
        ),
      ).toBe(false);
    });
  });

  describe('C4 — deadline computation', () => {
    const advancePaidAt = new Date('2026-08-14T10:00:00Z');

    it('gives 5 days for a same-city order', () => {
      const result = computeDeliveryDeadline({ advancePaidAt, sameCity: true });

      expect(result.windowDays).toBe(5);
      expect(result.deadlineAt.toISOString()).toBe('2026-08-19T10:00:00.000Z');
    });

    it('gives 10 days for a different-city order', () => {
      const result = computeDeliveryDeadline({ advancePaidAt, sameCity: false });

      expect(result.windowDays).toBe(10);
      expect(result.deadlineAt.toISOString()).toBe('2026-08-24T10:00:00.000Z');
    });

    it('measures from advance payment, not from order creation', () => {
      const later = new Date('2026-08-20T10:00:00Z');
      const result = computeDeliveryDeadline({ advancePaidAt: later, sameCity: true });

      expect(result.deadlineAt.toISOString()).toBe('2026-08-25T10:00:00.000Z');
    });

    it('rejects an invalid payment timestamp', () => {
      expect(() =>
        computeDeliveryDeadline({ advancePaidAt: new Date('nonsense'), sameCity: true }),
      ).toThrow();
    });

    it('maps the window to the correct helper', () => {
      expect(deliveryWindowDays(true)).toBe(5);
      expect(deliveryWindowDays(false)).toBe(10);
    });
  });

  describe('C5 — buyer-visible tracking', () => {
    const advancePaidAt = new Date('2026-08-14T10:00:00Z');

    it('exposes an i18n key that differs by branch', () => {
      const same = computeDeliveryDeadline({ advancePaidAt, sameCity: true });
      const different = computeDeliveryDeadline({ advancePaidAt, sameCity: false });

      expect(same.explanationKey).toBe('order.delivery.deadline_same_city');
      expect(different.explanationKey).toBe('order.delivery.deadline_different_city');
      // Never a hardcoded string, in either language.
      expect(same.explanationKey).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
    });

    it('counts down whole days remaining', () => {
      expect(
        daysRemaining(new Date('2026-08-19T10:00:00Z'), new Date('2026-08-14T10:00:00Z')),
      ).toBe(5);
    });

    it('goes negative once the deadline is breached', () => {
      expect(
        daysRemaining(new Date('2026-08-19T10:00:00Z'), new Date('2026-08-21T10:00:00Z')),
      ).toBe(-2);
    });
  });

  describe('overdue detection', () => {
    const deadline = new Date('2026-08-19T10:00:00Z');

    it('is not overdue before the deadline', () => {
      expect(isOverdue(deadline, new Date('2026-08-18T10:00:00Z'))).toBe(false);
    });

    it('is overdue after the deadline', () => {
      expect(isOverdue(deadline, new Date('2026-08-20T10:00:00Z'))).toBe(true);
    });

    it('is never overdue when the clock has not started', () => {
      // COD with no advance payment: no deadline exists yet. The schema
      // enforces this too (deadline_requires_payment_time).
      expect(isOverdue(null, new Date('2030-01-01T00:00:00Z'))).toBe(false);
    });
  });
});
