/**
 * Delivery clock — Digital Commerce Operation Guidelines 2021.
 *
 * Compliance rows C4, C5 (docs/compliance/compliance-matrix.md).
 *
 * The rule:
 *   Delivery within 5 days for the same city, 10 days for a different city,
 *   measured FROM ADVANCE PAYMENT. The deadline must be buyer-visible.
 *
 * Three decisions encoded here:
 *
 *  1. The clock starts at ADVANCE PAYMENT, not at order creation. A COD
 *     order with no advance has no deadline until money changes hands. The
 *     schema enforces this too (`deadline_requires_payment_time` CHECK).
 *
 *  2. "Same city" is decided by comparing DISTRICT (Zila) in the BD
 *     administrative hierarchy, not by a string match on a city name.
 *     See docs/localization/bangladesh-localization.md.
 *
 *  3. Days are counted as 24-hour periods in UTC, then rendered in
 *     Asia/Dhaka for display. Bangladesh has a single timezone (UTC+06) and
 *     does not currently observe DST, so this is unambiguous -- but the
 *     deadline is stored as TIMESTAMPTZ so it stays correct regardless.
 *
 * Pure: no database, no framework, no I/O.
 *
 * Lives in common/compliance rather than in a feature module because BOTH
 * `order` (to derive same-city at creation) and `payment` (to stamp the
 * deadline when an advance settles) need it. A regulated rule with two
 * callers must have exactly one implementation -- duplicating it per module
 * is how the 5-day and 10-day windows drift apart.
 */

/** DCOG 2021 delivery windows, in days from advance payment. */
export const SAME_CITY_DELIVERY_DAYS = 5;
export const DIFFERENT_CITY_DELIVERY_DAYS = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The parts of a Location needed to decide same-city.
 * Mirrors the BD administrative hierarchy in the canonical model.
 */
export interface DistrictRef {
  readonly division: string;
  readonly district: string;
}

/** Normalise for comparison: administrative names vary in case and spacing. */
function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Determine whether two locations are in the same city for delivery-clock
 * purposes.
 *
 * Compares District (Zila), qualified by Division -- district names are not
 * globally unique across divisions in Bangladesh, so district alone would
 * occasionally produce a false "same city" and understate the legal window.
 */
export function isSameCity(merchant: DistrictRef, delivery: DistrictRef): boolean {
  return (
    normalise(merchant.division) === normalise(delivery.division) &&
    normalise(merchant.district) === normalise(delivery.district)
  );
}

/** Days permitted for this order under DCOG 2021. */
export function deliveryWindowDays(sameCity: boolean): number {
  return sameCity ? SAME_CITY_DELIVERY_DAYS : DIFFERENT_CITY_DELIVERY_DAYS;
}

export interface DeliveryDeadlineInput {
  /** When the advance payment settled. The clock starts here, not at order creation. */
  readonly advancePaidAt: Date;
  readonly sameCity: boolean;
}

export interface DeliveryDeadline {
  readonly deadlineAt: Date;
  readonly windowDays: number;
  /** i18n key for the buyer-visible commitment (row C5). */
  readonly explanationKey: string;
}

/**
 * Compute the regulated delivery deadline.
 *
 * Returns a value object; persisting it into app_order.delivery_deadline_at
 * happens in the same database transaction that records the advance payment
 * (see docs/architecture/backend-modules.md, order-creation path step 6).
 */
export function computeDeliveryDeadline(input: DeliveryDeadlineInput): DeliveryDeadline {
  const { advancePaidAt, sameCity } = input;

  if (Number.isNaN(advancePaidAt.getTime())) {
    throw new Error('advancePaidAt is not a valid Date');
  }

  const windowDays = deliveryWindowDays(sameCity);

  return {
    deadlineAt: new Date(advancePaidAt.getTime() + windowDays * MS_PER_DAY),
    windowDays,
    explanationKey: sameCity
      ? 'order.delivery.deadline_same_city'
      : 'order.delivery.deadline_different_city',
  };
}

/**
 * Whether an undelivered order has passed its regulated deadline.
 *
 * Used by the merchant-facing overdue view and by ops alerting. A breach is
 * a regulatory exposure, not merely a late delivery, so it must be visible
 * rather than quietly tolerated.
 */
export function isOverdue(deadlineAt: Date | null, now: Date): boolean {
  if (deadlineAt === null) {
    return false; // Clock never started: no advance payment yet.
  }
  return now.getTime() > deadlineAt.getTime();
}

/**
 * Whole days remaining until the deadline; negative once breached.
 * Feeds the buyer-visible countdown (row C5).
 */
export function daysRemaining(deadlineAt: Date, now: Date): number {
  return Math.floor((deadlineAt.getTime() - now.getTime()) / MS_PER_DAY);
}
