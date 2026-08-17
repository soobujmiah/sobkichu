/**
 * Location HTTP surface.
 *
 * Protected by the default global guard (no @Public()): addresses are
 * created in the context of a signed-in caller, same as order and merchant
 * onboarding writes elsewhere in the API.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { CreateLocationDto } from './dto/create-location.dto';
import { CreatedLocation, LocationService } from './location.service';

@Controller('locations')
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateLocationDto): Promise<CreatedLocation> {
    return this.locations.createLocation(dto);
  }
}
