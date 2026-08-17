/**
 * Catalog HTTP surface.
 *
 * Thin by design, same rationale as OrderController: compliance and pricing
 * rules live in CatalogService so they are testable without HTTP.
 */

import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthenticatedCaller } from '../common/auth/auth.guard';
import { Caller } from '../common/auth/caller.decorator';

import { CatalogService, CreatedListing } from './catalog.service';
import { CreateListingDto } from './dto/create-listing.dto';

@Controller('catalog/listings')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateListingDto,
    @Caller() caller: AuthenticatedCaller,
  ): Promise<CreatedListing> {
    return this.catalog.createListing({
      // From the verified session, never from the body: reading it from the
      // request would let any client publish under any merchant's identity.
      ownerRoleId: caller.activeRoleId,
      type: dto.type,
      categoryId: dto.categoryId,
      titleBn: dto.titleBn,
      titleEn: dto.titleEn,
      descriptionBn: dto.descriptionBn,
      descriptionEn: dto.descriptionEn,
      priceBdtPoisha: dto.priceBdtPoisha,
      readyToShip: dto.readyToShip,
      stockQty: dto.stockQty,
    });
  }
}
