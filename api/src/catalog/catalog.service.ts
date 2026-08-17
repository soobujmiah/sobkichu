/**
 * Listing creation — the merchant-mode write path.
 *
 * Phase 1 DoD (docs/roadmap.md): "Merchant: listing creation with
 * ready_to_ship". Gated the same way order creation gates a merchant's
 * ability to transact (compliance row K1) -- an unverified merchant must not
 * be able to publish inventory any more than they can receive an order.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';

import { poishaToTaka, takaToPoisha } from '../common/money';
import { LOCATION_PORT, LocationPort } from '../common/ports/location.port';
import { MERCHANT_PORT, MerchantPort } from '../common/ports/merchant.port';

import { CatalogRepository } from './catalog.repository';

/** Roadmap Phase 1 DoD: "GPS radius discovery (1-10 km)". */
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 10;
const MAX_SEARCH_RESULTS = 50;

export interface CreateListingCommand {
  /** The caller's active role id -- never trusted from the request body. */
  readonly ownerRoleId: string | null;
  readonly type: 'product' | 'service_slot';
  readonly categoryId: string;
  readonly titleBn: string;
  readonly titleEn?: string;
  readonly descriptionBn?: string;
  readonly descriptionEn?: string;
  readonly priceBdtPoisha: number;
  readonly readyToShip: boolean;
  readonly stockQty?: number;
}

export interface CreatedListing {
  readonly listingId: string;
}

export interface SearchNearbyCommand {
  readonly lat: number;
  readonly lng: number;
  readonly radiusKm: number;
}

export interface NearbyListing {
  readonly listingId: string;
  readonly titleBn: string;
  readonly titleEn: string | null;
  readonly priceBdtPoisha: number;
  readonly readyToShip: boolean;
  readonly type: 'product' | 'service_slot';
  readonly distanceMeters: number;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(MERCHANT_PORT) private readonly merchants: MerchantPort,
    @Inject(LOCATION_PORT) private readonly locations: LocationPort,
    private readonly listings: CatalogRepository,
  ) {}

  async createListing(command: CreateListingCommand): Promise<CreatedListing> {
    // --- 1. Caller must be acting as a role, and that role a merchant ------
    if (!command.ownerRoleId) {
      // Role switching isn't wired up yet (activeRoleId exists on the token,
      // nothing sets it) -- surface that as a clear precondition rather than
      // a confusing downstream failure.
      throw new BadRequestException('error.catalog.no_active_role');
    }

    // Throws NotFoundException if the role doesn't exist or isn't a
    // merchant role (MerchantAdapter) -- propagates as-is, same as order.
    const merchant = await this.merchants.findMerchant(command.ownerRoleId);

    if (!merchant.isActive) {
      throw new BadRequestException('error.catalog.merchant_unavailable');
    }
    if (!merchant.kycVerified) {
      // NID KYC gates publishing, same as it gates transacting (K1).
      throw new ForbiddenException('error.catalog.merchant_not_verified');
    }
    if (!merchant.pickupLocationId) {
      // Phase 1 has one location per merchant; a listing needs an origin
      // for radius search and same-city determination.
      throw new BadRequestException('error.catalog.merchant_no_pickup_address');
    }

    // --- 2. Category must exist and must not be prohibited (C8/C9) --------
    const category = await this.listings.findCategory(command.categoryId);

    if (!category) {
      throw new BadRequestException('error.catalog.category_not_found');
    }
    if (category.is_restricted) {
      throw new BadRequestException('error.catalog.category_prohibited');
    }
    if (category.requires_dgda_licence) {
      // Medicine/healthcare needs DGDA licensing -- Phase 3, flag off.
      throw new BadRequestException('error.catalog.category_requires_licence');
    }

    // --- 3. Denormalise geo from the pickup location for radius search -----
    // Throws NotFoundException only if the id is dangling, which would mean
    // the FK on role.pickup_location_id was violated some other way -- not
    // reachable through this path, but not swallowed either.
    const pickupLocation = await this.locations.findById(merchant.pickupLocationId);

    // --- 4. Persist ----------------------------------------------------------
    const listingId = await this.listings.insertListing({
      ownerRoleId: command.ownerRoleId,
      locationId: merchant.pickupLocationId,
      type: command.type,
      categoryId: command.categoryId,
      titleBn: command.titleBn,
      titleEn: command.titleEn ?? null,
      descriptionBn: command.descriptionBn ?? null,
      descriptionEn: command.descriptionEn ?? null,
      priceBdt: poishaToTaka(command.priceBdtPoisha),
      readyToShip: command.readyToShip,
      // Service slots carry no stock count; a client-supplied 0 would read
      // as "out of stock" rather than "not stock-tracked".
      stockQty: command.type === 'service_slot' ? null : (command.stockQty ?? null),
      // Both null when the pickup location has no GPS fix -- a manual-address
      // merchant's listings simply do not surface in radius search, same as
      // the location itself is a first-class, not degraded, address.
      lat: pickupLocation.lat,
      lng: pickupLocation.lng,
    });

    return { listingId };
  }

  /**
   * Radius search (roadmap Phase 1 DoD: "GPS radius discovery (1-10 km)").
   *
   * Always paired with a manual address fallback per
   * docs/localization/bangladesh-localization.md -- this method covers only
   * the GPS path; browsing by category/hierarchy is separate, not-yet-built
   * work (CURRENT_STATE.md).
   */
  async searchNearby(command: SearchNearbyCommand): Promise<NearbyListing[]> {
    if (command.radiusKm < MIN_RADIUS_KM || command.radiusKm > MAX_RADIUS_KM) {
      throw new BadRequestException('error.catalog.radius_out_of_range');
    }

    const rows = await this.listings.searchNearby(
      command.lat,
      command.lng,
      command.radiusKm * 1000,
      MAX_SEARCH_RESULTS,
    );

    return rows.map((row) => ({
      listingId: row.id,
      titleBn: row.title_bn,
      titleEn: row.title_en,
      priceBdtPoisha: takaToPoisha(row.price_bdt),
      readyToShip: row.ready_to_ship,
      type: row.type,
      distanceMeters: row.distance_m,
    }));
  }
}
