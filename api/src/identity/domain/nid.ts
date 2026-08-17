/**
 * Bangladesh National ID number format.
 *
 * Three formats are in live circulation, all digits-only once separators are
 * stripped:
 *
 *  - 10 digits: Smart NID (issued from 2016)
 *  - 13 digits: old NID
 *  - 17 digits: old NID prefixed with a 4-digit birth year, used for the
 *    online verification service
 *
 * This does NOT verify the number against the National ID register --
 * no such integration exists yet (MASTER_PROMPT.md notes this as future
 * work, no vendor named). It only rejects the class of input that could not
 * possibly be a real NID (wrong shape), same role phone normalisation plays
 * for phone numbers.
 *
 * Pure. No framework imports, no I/O.
 */

const VALID_LENGTHS = [10, 13, 17];

/**
 * Strip common separators and validate shape.
 *
 * Returns the normalised digit-only string, or null when the input cannot
 * be a real NID number -- non-digit characters remaining after stripping
 * spaces/dashes, or a length that matches none of the three live formats.
 */
export function normaliseNidNumber(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  if (!VALID_LENGTHS.includes(digits.length)) {
    return null;
  }

  return digits;
}
