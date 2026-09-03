import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicQualitySource } from '../../entities/public-quality-source.entity';
import { SourceRecord } from '../../entities/source-record.entity';
import { PublicQualityService } from './public-quality.service';

// Read side of BP §10.3 (Public Quality, per source, never averaged). The
// write side is the loader script `scripts/load-imdb-ratings.ts`.
@Module({
  imports: [TypeOrmModule.forFeature([PublicQualitySource, SourceRecord])],
  providers: [PublicQualityService],
  exports: [PublicQualityService],
})
export class PublicQualityModule {}
