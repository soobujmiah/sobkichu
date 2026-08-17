/**
 * Location module. Owns the `location` table and the BD address hierarchy.
 */

import { Module } from '@nestjs/common';

import { LOCATION_PORT } from '../common/ports/location.port';

import { LocationAdapter } from './location.adapter';
import { LocationController } from './location.controller';
import { LocationRepository } from './location.repository';
import { LocationService } from './location.service';

@Module({
  controllers: [LocationController],
  providers: [
    LocationAdapter,
    LocationRepository,
    LocationService,
    { provide: LOCATION_PORT, useExisting: LocationAdapter },
  ],
  exports: [LOCATION_PORT],
})
export class LocationModule {}
