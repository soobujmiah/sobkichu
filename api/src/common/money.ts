/**
 * BDT money handling.
 *
 * Phase 1 is BDT-only (master prompt Section 5), so there is deliberately no
 * currency dimension here. Adding one later is cheaper than carrying unused
 * multi-currency logic now.
 *
 * Everything is computed in integer POISHA (1/100 taka), never in floating
 * point. `0.1 * 3` is `0.30000000000000004` in IEEE-754, and this module
 * computes a legally-capped payment amount -- float drift is not acceptable
 * in that path.
 *
 * The database stores NUMERIC(12,2); this module is the boundary that
 * converts to and from that representation.
 *
 * Pure. No framework imports, no I/O.
 */

/** An amount in poisha (1/100 BDT). Always an integer. */
export type Poisha = number;

/** Maximum representable amount, matching NUMERIC(12,2) in the schema. */
const MAX_TAKA = 9_999_999_999.99;

export class MoneyError extends Error {}

/**
 * Convert a BDT amount (as stored in NUMERIC(12,2)) to integer poisha.
 *
 * Accepts a string (preferred -- this is what a Postgres driver returns for
 * NUMERIC) or a number. Rejects anything with sub-poisha precision rather
 * than silently rounding it, because a silent round in a payment path hides
 * a bug upstream.
 */
export function takaToPoisha(amount: string | number): Poisha {
  const text = typeof amount === 'number' ? amount.toFixed(10) : amount.trim();

  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new MoneyError(`Not a valid BDT amount: ${JSON.stringify(amount)}`);
  }

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');

  // Anything beyond two decimal places must be exactly zero. Trailing zeros
  // ('10.9990') lose no precision and are accepted -- a Postgres NUMERIC
  // driver can legitimately hand back that form. A non-zero third decimal
  // ('10.999') is rejected rather than rounded, because a silent round in a
  // payment path hides a bug upstream.
  if (/[1-9]/.test(fraction.slice(2))) {
    throw new MoneyError(
      `BDT amount has sub-poisha precision and would be silently rounded: ${text}`,
    );
  }

  const paddedFraction = fraction.padEnd(2, '0').slice(0, 2);
  const poisha = Number(whole) * 100 + Number(paddedFraction);

  if (!Number.isSafeInteger(poisha)) {
    throw new MoneyError(`BDT amount out of safe range: ${text}`);
  }

  return negative ? -poisha : poisha;
}

/** Convert integer poisha back to the NUMERIC(12,2) string the database expects. */
export function poishaToTaka(poisha: Poisha): string {
  if (!Number.isInteger(poisha)) {
    throw new MoneyError(`Poisha must be an integer, got ${poisha}`);
  }

  const negative = poisha < 0;
  const absolute = Math.abs(poisha);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');

  if (whole > MAX_TAKA) {
    throw new MoneyError(`Amount exceeds NUMERIC(12,2): ${whole}.${fraction}`);
  }

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Take a percentage of an amount, rounding DOWN.
 *
 * Rounding direction is a compliance decision, not a style choice. This is
 * used to compute a legal MAXIMUM (the DCOG 2021 advance-payment cap), so
 * rounding up could authorise an advance fractionally above the permitted
 * percentage. Down is the only safe direction for a cap.
 *
 * See docs/compliance/compliance-matrix.md row C1.
 */
export function percentageOf(amount: Poisha, percent: number): Poisha {
  if (!Number.isInteger(amount)) {
    throw new MoneyError(`Amount must be integer poisha, got ${amount}`);
  }
  if (!(percent >= 0 && percent <= 100)) {
    throw new MoneyError(`Percent must be between 0 and 100, got ${percent}`);
  }

  // Integer arithmetic throughout: (amount * percent) / 100, floored.
  return Math.floor((amount * percent) / 100);
}

/** Sum a list of poisha amounts, rejecting non-integers. */
export function sum(amounts: readonly Poisha[]): Poisha {
  return amounts.reduce<Poisha>((total, amount) => {
    if (!Number.isInteger(amount)) {
      throw new MoneyError(`Amount must be integer poisha, got ${amount}`);
    }
    return total + amount;
  }, 0);
}

/** Multiply a unit price by a whole quantity. */
export function multiply(unitPrice: Poisha, quantity: number): Poisha {
  if (!Number.isInteger(unitPrice)) {
    throw new MoneyError(`Unit price must be integer poisha, got ${unitPrice}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new MoneyError(`Quantity must be a positive integer, got ${quantity}`);
  }
  return unitPrice * quantity;
}
