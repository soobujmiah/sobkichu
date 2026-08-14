/**
 * Location module. Owns the `location` table and the BD address hierarchy.
 */

import { Module } from '@nestjs/common';

import { LOCATION_PORT } from '../common/ports/location.port';

import { LocationAdapter } from './location.adapter';

@Module({
  providers: [LocationAdapter, { provide: LOCATION_PORT, useExisting: LocationAdapter }],
  exports: [LOCATION_PORT],
})
export class LocationModule {}
