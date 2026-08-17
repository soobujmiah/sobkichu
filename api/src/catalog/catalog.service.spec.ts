/**
 * Listing creation — compliance regression tests at the service level.
 *
 * Mirrors order.service.spec.ts: in-memory fakes for the ports, no database,
 * proving CatalogService applies the K1/C8/C9 gates rather than trusting the
 * client or leaving them to the UI (ADR-0005).
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { takaToPoisha } from '../common/money';
import { MerchantPort, MerchantSummary } from '../common/ports/merchant.port';

import { CatalogService, CreateListingCommand } from './catalog.service';
import { CategoryRow, CatalogRepository, NewListingRecord } from './catalog.repository';

const MERCHANT_ROLE = '33333333-3333-4333-8333-000000000003';
const PICKUP_LOCATION = '11111111-1111-4111-8111-000000000001';
const OPEN_CATEGORY = '44444444-4444-4444-8444-000000000001';
const RESTRICTED_CATEGORY = '44444444-4444-4444-8444-000000000002';
const DGDA_CATEGORY = '44444444-4444-4444-8444-000000000003';
const UNKNOWN_CATEGORY = '44444444-4444-4444-8444-000000000099';

class FakeMerchantPort implements MerchantPort {
  constructor(private readonly summary: MerchantSummary | 'not_found') {}

  async findMerchant(roleId: string): Promise<MerchantSummary> {
    if (this.summary === 'not_found') {
      throw new NotFoundException('error.checkout.merchant_not_found');
    }
    if (this.summary.roleId !== roleId) {
      throw new NotFoundException('error.checkout.merchant_not_found');
    }
    return this.summary;
  }
}

const verifiedMerchant = (overrides: Partial<MerchantSummary> = {}): MerchantSummary => ({
  roleId: MERCHANT_ROLE,
  kycVerified: true,
  isActive: true,
  pickupLocationId: PICKUP_LOCATION,
  ...overrides,
});

/** Records what the service tried to persist. */
class RecordingRepository extends CatalogRepository {
  inserted: NewListingRecord[] = [];

  constructor(private readonly categories: Record<string, CategoryRow>) {
    super(undefined as never);
  }

  override async findCategory(id: string): Promise<CategoryRow | null> {
    return this.categories[id] ?? null;
  }

  override async insertListing(record: NewListingRecord): Promise<string> {
    this.inserted.push(record);
    return 'listing-1';
  }
}

const category = (
  id: string,
  isRestricted: boolean,
  requiresDgdaLicence: boolean,
): CategoryRow => ({
  id,
  is_restricted: isRestricted,
  requires_dgda_licence: requiresDgdaLicence,
});

const CATEGORIES: Record<string, CategoryRow> = {
  [OPEN_CATEGORY]: category(OPEN_CATEGORY, false, false),
  [RESTRICTED_CATEGORY]: category(RESTRICTED_CATEGORY, true, false),
  [DGDA_CATEGORY]: category(DGDA_CATEGORY, false, true),
};

const baseCommand = (
  overrides: Partial<CreateListingCommand> = {},
): CreateListingCommand => ({
  ownerRoleId: MERCHANT_ROLE,
  type: 'product',
  categoryId: OPEN_CATEGORY,
  titleBn: 'পণ্যের নাম',
  priceBdtPoisha: takaToPoisha('500.00'),
  readyToShip: true,
  stockQty: 10,
  ...overrides,
});

function buildService(
  merchant: MerchantSummary | 'not_found',
  categories: Record<string, CategoryRow> = CATEGORIES,
) {
  const repository = new RecordingRepository(categories);
  const service = new CatalogService(new FakeMerchantPort(merchant), repository);
  return { service, repository };
}

describe('CatalogService.createListing', () => {
  it('persists under the active merchant role and pickup location', async () => {
    const { service, repository } = buildService(verifiedMerchant());

    const result = await service.createListing(baseCommand());

    expect(result.listingId).toBe('listing-1');
    expect(repository.inserted).toHaveLength(1);
    expect(repository.inserted[0]).toMatchObject({
      ownerRoleId: MERCHANT_ROLE,
      locationId: PICKUP_LOCATION,
      categoryId: OPEN_CATEGORY,
      priceBdt: '500.00',
      readyToShip: true,
      stockQty: 10,
    });
  });

  it('rejects when no active role is set (role switching not wired up yet)', async () => {
    const { service } = buildService(verifiedMerchant());

    await expect(
      service.createListing(baseCommand({ ownerRoleId: null })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unverified merchant (K1)', async () => {
    const { service } = buildService(verifiedMerchant({ kycVerified: false }));

    await expect(service.createListing(baseCommand())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects an inactive merchant', async () => {
    const { service } = buildService(verifiedMerchant({ isActive: false }));

    await expect(service.createListing(baseCommand())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a merchant with no registered pickup location', async () => {
    const { service } = buildService(verifiedMerchant({ pickupLocationId: null }));

    await expect(service.createListing(baseCommand())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an unknown category', async () => {
    const { service } = buildService(verifiedMerchant());

    await expect(
      service.createListing(baseCommand({ categoryId: UNKNOWN_CATEGORY })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a prohibited category (C8 -- MLM, lottery/gambling)', async () => {
    const { service } = buildService(verifiedMerchant());

    await expect(
      service.createListing(baseCommand({ categoryId: RESTRICTED_CATEGORY })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a category requiring DGDA licence (C9 -- Phase 3, flag off)', async () => {
    const { service } = buildService(verifiedMerchant());

    await expect(
      service.createListing(baseCommand({ categoryId: DGDA_CATEGORY })),
    ).rejects.toThrow(BadRequestException);
  });

  it('forces stockQty null for service slots, even if the client sends one', async () => {
    const { service, repository } = buildService(verifiedMerchant());

    await service.createListing(baseCommand({ type: 'service_slot', stockQty: 5 }));

    expect(repository.inserted[0].stockQty).toBeNull();
    expect(repository.inserted[0].type).toBe('service_slot');
  });

  it('propagates "not found" when the active role is not a merchant role', async () => {
    const { service } = buildService('not_found');

    await expect(service.createListing(baseCommand())).rejects.toThrow(NotFoundException);
  });
});
