/**
 * Address creation — service-level tests.
 *
 * In-memory LocationRepository fake, no database: proves the lat/lng
 * pairing rule and that optional fields default to null rather than
 * `undefined` reaching the repository (Postgres driver rejects `undefined`
 * params).
 */

import { BadRequestException } from '@nestjs/common';

import { CreateLocationCommand, LocationService } from './location.service';
import { LocationRepository, NewLocationRecord } from './location.repository';

class RecordingRepository extends LocationRepository {
  inserted: NewLocationRecord[] = [];

  constructor() {
    super(undefined as never);
  }

  override async insertLocation(record: NewLocationRecord): Promise<string> {
    this.inserted.push(record);
    return 'location-1';
  }
}

const baseCommand = (
  overrides: Partial<CreateLocationCommand> = {},
): CreateLocationCommand => ({
  division: 'Dhaka',
  district: 'Dhaka',
  upazilaThana: 'Kotwali',
  ...overrides,
});

describe('LocationService.createLocation', () => {
  it('creates a manual address with no coordinates', async () => {
    const repository = new RecordingRepository();
    const service = new LocationService(repository);

    const result = await service.createLocation(baseCommand());

    expect(result).toEqual({ locationId: 'location-1' });
    expect(repository.inserted[0]).toMatchObject({
      division: 'Dhaka',
      district: 'Dhaka',
      upazilaThana: 'Kotwali',
      unionWard: null,
      villageMohalla: null,
      addressLine: null,
      lat: null,
      lng: null,
    });
  });

  it('creates a location with a GPS fix when both coordinates are given', async () => {
    const repository = new RecordingRepository();
    const service = new LocationService(repository);

    await service.createLocation(baseCommand({ lat: 23.777176, lng: 90.399452 }));

    expect(repository.inserted[0].lat).toBe(23.777176);
    expect(repository.inserted[0].lng).toBe(90.399452);
  });

  it('rejects latitude without longitude', async () => {
    const repository = new RecordingRepository();
    const service = new LocationService(repository);

    await expect(
      service.createLocation(baseCommand({ lat: 23.777176 })),
    ).rejects.toThrow(BadRequestException);
    expect(repository.inserted).toEqual([]);
  });

  it('rejects longitude without latitude', async () => {
    const repository = new RecordingRepository();
    const service = new LocationService(repository);

    await expect(
      service.createLocation(baseCommand({ lng: 90.399452 })),
    ).rejects.toThrow(BadRequestException);
    expect(repository.inserted).toEqual([]);
  });

  it('carries the optional hierarchy levels and address line through', async () => {
    const repository = new RecordingRepository();
    const service = new LocationService(repository);

    await service.createLocation(
      baseCommand({
        unionWard: 'Ward 5',
        villageMohalla: 'Lalbagh',
        addressLine: 'House 12, Road 3',
      }),
    );

    expect(repository.inserted[0]).toMatchObject({
      unionWard: 'Ward 5',
      villageMohalla: 'Lalbagh',
      addressLine: 'House 12, Road 3',
    });
  });
});
