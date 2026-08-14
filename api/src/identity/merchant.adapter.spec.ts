/**
 * Merchant adapter tests.
 *
 * The compliance-bearing part is the KYC translation: role.kyc_status is a
 * four-value enum, and only 'verified' permits a merchant to transact
 * (compliance row K1). Getting this wrong lets an unverified merchant take
 * orders, so it is tested as an allowlist rather than by example.
 */

import { NotFoundException } from '@nestjs/common';

import { MerchantAdapter } from './merchant.adapter';

const pool = (rows: unknown[]) =>
  ({ query: async () => ({ rows }) }) as never;

describe('MerchantAdapter', () => {
  describe('KYC translation (compliance K1)', () => {
    it.each([
      ['verified', true],
      ['pending', false],
      ['rejected', false],
      ['unverified', false],
    ])('maps kyc_status %s to kycVerified %s', async (status, expected) => {
      const adapter = new MerchantAdapter(
        pool([
          {
            id: 'r1',
            kyc_status: status,
            is_active: true,
            pickup_location_id: 'loc-1',
          },
        ]),
      );

      const merchant = await adapter.findMerchant('r1');

      expect(merchant.kycVerified).toBe(expected);
    });

    it('treats an unrecognised status as unverified', async () => {
      // Allowlist, not denylist: a future enum value must not accidentally
      // read as verified.
      const adapter = new MerchantAdapter(
        pool([
          {
            id: 'r1',
            kyc_status: 'some_future_value',
            is_active: true,
            pickup_location_id: 'loc-1',
          },
        ]),
      );

      await expect(adapter.findMerchant('r1')).resolves.toMatchObject({
        kycVerified: false,
      });
    });
  });

  it('throws when the role is unknown or is not a merchant', async () => {
    const adapter = new MerchantAdapter(pool([]));

    await expect(adapter.findMerchant('nope')).rejects.toThrow(NotFoundException);
  });

  it('passes through a null pickup location', async () => {
    // The service rejects this case; the adapter must not invent a value.
    const adapter = new MerchantAdapter(
      pool([
        { id: 'r1', kyc_status: 'verified', is_active: true, pickup_location_id: null },
      ]),
    );

    await expect(adapter.findMerchant('r1')).resolves.toMatchObject({
      pickupLocationId: null,
    });
  });
});
