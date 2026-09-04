import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentFeature } from '../../entities/content-feature.entity';
import { Title } from '../../entities/title.entity';
import { PublicQualityModule } from '../public-quality/public-quality.module';
import { TitlesController } from './titles.controller';
import { TitlesService } from './titles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Title, ContentFeature]), PublicQualityModule],
  controllers: [TitlesController],
  providers: [TitlesService],
  exports: [TitlesService],
})
export class TitlesModule {}