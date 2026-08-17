/**
 * NID format tests.
 *
 * Shape validation only -- there is no register to check against yet, so
 * these guard against garbage input, not fraud.
 */

import { normaliseNidNumber } from './nid';

describe('normaliseNidNumber', () => {
  it('accepts a 10-digit Smart NID', () => {
    expect(normaliseNidNumber('1234567890')).toBe('1234567890');
  });

  it('accepts a 13-digit old NID', () => {
    expect(normaliseNidNumber('1234567890123')).toBe('1234567890123');
  });

  it('accepts a 17-digit birth-year-prefixed NID', () => {
    expect(normaliseNidNumber('12345678901234567')).toBe('12345678901234567');
  });

  it('strips spaces and dashes before validating', () => {
    expect(normaliseNidNumber('1234 5678-90')).toBe('1234567890');
  });

  it('rejects a length matching none of the three live formats', () => {
    expect(normaliseNidNumber('12345')).toBeNull();
    expect(normaliseNidNumber('123456789012')).toBeNull();
  });

  it('rejects non-digit characters that survive separator stripping', () => {
    expect(normaliseNidNumber('12345abcde')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(normaliseNidNumber('')).toBeNull();
  });
});
