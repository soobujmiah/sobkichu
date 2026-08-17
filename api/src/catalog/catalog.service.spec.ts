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
import { LocationPort, ResolvedLocation } from '../common/ports/location.port';
import { MerchantPort, MerchantSummary } from '../common/ports/merchant.port';

import {
  CatalogService,
  CreateListingCommand,
  SearchNearbyCommand,
} from './catalog.service';
import {
  CategoryRow,
  CatalogRepository,
  NearbyListingRow,
  NewListingRecord,
} from './catalog.repository';

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

class FakeLocationPort implements LocationPort {
  constructor(private readonly location: ResolvedLocation) {}

  async findById(): Promise<ResolvedLocation> {
    return this.location;
  }
}

const resolvedLocation = (
  overrides: Partial<ResolvedLocation> = {},
): ResolvedLocation => ({
  id: PICKUP_LOCATION,
  division: 'Dhaka',
  district: 'Dhaka',
  upazilaThana: 'Kotwali',
  unionWard: null,
  villageMohalla: null,
  addressLine: null,
  hasGeo: true,
  lat: 23.777176,
  lng: 90.399452,
  ...overrides,
});

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
  nearbyResults: NearbyListingRow[] = [];
  nearbyCalls: Array<{ lat: number; lng: number; radiusMeters: number; limit: number }> =
    [];

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

  override async searchNearby(
    lat: number,
    lng: number,
    radiusMeters: number,
    limit: number,
  ): Promise<NearbyListingRow[]> {
    this.nearbyCalls.push({ lat, lng, radiusMeters, limit });
    return this.nearbyResults;
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
  location: ResolvedLocation = resolvedLocation(),
) {
  const repository = new RecordingRepository(categories);
  const service = new CatalogService(
    new FakeMerchantPort(merchant),
    new FakeLocationPort(location),
    repository,
  );
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

  it("denormalises the pickup location's coordinates onto the listing", async () => {
    const { service, repository } = buildService(
      verifiedMerchant(),
      CATEGORIES,
      resolvedLocation({ lat: 23.7, lng: 90.4 }),
    );

    await service.createListing(baseCommand());

    expect(repository.inserted[0].lat).toBe(23.7);
    expect(repository.inserted[0].lng).toBe(90.4);
  });

  it('leaves geo null when the pickup location has no GPS fix', async () => {
    const { service, repository } = buildService(
      verifiedMerchant(),
      CATEGORIES,
      resolvedLocation({ hasGeo: false, lat: null, lng: null }),
    );

    await service.createListing(baseCommand());

    expect(repository.inserted[0].lat).toBeNull();
    expect(repository.inserted[0].lng).toBeNull();
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

describe('CatalogService.searchNearby', () => {
  const baseSearch = (
    overrides: Partial<SearchNearbyCommand> = {},
  ): SearchNearbyCommand => ({
    lat: 23.777176,
    lng: 90.399452,
    radiusKm: 5,
    ...overrides,
  });

  it('converts km to metres and maps rows into poisha-priced results', async () => {
    const { service, repository } = buildService(verifiedMerchant());
    repository.nearbyResults = [
      {
        id: 'listing-1',
        title_bn: 'পণ্য',
        title_en: 'Item',
        price_bdt: '250.00',
        ready_to_ship: true,
        type: 'product',
        distance_m: 1200.5,
      },
    ];

    const result = await service.searchNearby(baseSearch({ radiusKm: 3 }));

    expect(repository.nearbyCalls[0]).toMatchObject({
      lat: 23.777176,
      lng: 90.399452,
      radiusMeters: 3000,
    });
    expect(result).toEqual([
      {
        listingId: 'listing-1',
        titleBn: 'পণ্য',
        titleEn: 'Item',
        priceBdtPoisha: takaToPoisha('250.00'),
        readyToShip: true,
        type: 'product',
        distanceMeters: 1200.5,
      },
    ]);
  });

  it('rejects a radius below 1 km', async () => {
    const { service } = buildService(verifiedMerchant());

    await expect(service.searchNearby(baseSearch({ radiusKm: 0.5 }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a radius above 10 km', async () => {
    const { service } = buildService(verifiedMerchant());

    await expect(service.searchNearby(baseSearch({ radiusKm: 11 }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts the boundary values 1 and 10 km', async () => {
    const { service, repository } = buildService(verifiedMerchant());

    await service.searchNearby(baseSearch({ radiusKm: 1 }));
    await service.searchNearby(baseSearch({ radiusKm: 10 }));

    expect(repository.nearbyCalls.map((call) => call.radiusMeters)).toEqual([
      1000, 10000,
    ]);
  });
});
