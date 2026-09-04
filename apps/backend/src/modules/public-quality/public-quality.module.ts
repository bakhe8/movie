import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicQualitySource } from '../../entities/public-quality-source.entity';
import { SourceRecord } from '../../entities/source-record.entity';
import { AttributionService } from './attribution.service';
import { PublicQualityRefreshService } from './public-quality-refresh.service';
import { PosterService } from './poster.service';
import { PublicQualityService } from './public-quality.service';

// Read side of BP §10.3 (Public Quality, per source, never averaged). The
// write side is the loader script `scripts/load-imdb-ratings.ts`, run by hand
// or on a schedule by PublicQualityRefreshService.
@Module({
  imports: [TypeOrmModule.forFeature([PublicQualitySource, SourceRecord])],
  providers: [PublicQualityService, PublicQualityRefreshService, AttributionService, PosterService],
  exports: [PublicQualityService, AttributionService, PosterService],
})
export class PublicQualityModule {}
