/**
 * Address creation.
 *
 * No compliance gate here -- unlike listing or order creation, creating a
 * structured address carries no legal weight by itself. It becomes
 * compliance-bearing only once referenced as a merchant's pickup location or
 * an order's delivery location, which is where OrderService and
 * MerchantOnboardingService already resolve it.
 */

import { BadRequestException, Injectable } from '@nestjs/common';

import { LocationRepository } from './location.repository';

export interface CreateLocationCommand {
  readonly division: string;
  readonly district: string;
  readonly upazilaThana: string;
  readonly unionWard?: string;
  readonly villageMohalla?: string;
  readonly addressLine?: string;
  readonly lat?: number;
  readonly lng?: number;
}

export interface CreatedLocation {
  readonly locationId: string;
}

@Injectable()
export class LocationService {
  constructor(private readonly locations: LocationRepository) {}

  async createLocation(command: CreateLocationCommand): Promise<CreatedLocation> {
    // Both-or-neither: a lone coordinate is more likely a client bug (one
    // field dropped in transit) than a deliberate half-GPS-fix, and geo
    // is a Point -- there is no way to store just one axis correctly.
    if ((command.lat === undefined) !== (command.lng === undefined)) {
      throw new BadRequestException('error.address.lat_lng_must_be_paired');
    }

    const locationId = await this.locations.insertLocation({
      division: command.division,
      district: command.district,
      upazilaThana: command.upazilaThana,
      unionWard: command.unionWard ?? null,
      villageMohalla: command.villageMohalla ?? null,
      addressLine: command.addressLine ?? null,
      lat: command.lat ?? null,
      lng: command.lng ?? null,
    });

    return { locationId };
  }
}
