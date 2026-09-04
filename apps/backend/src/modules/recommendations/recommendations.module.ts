import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModelVersion } from '../../entities/model-version.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { ExperimentsModule } from '../experiments/experiments.module';
import { PublicQualityModule } from '../public-quality/public-quality.module';
import { TrainingModule } from '../training/training.module';
import { LibraryController } from './library.controller';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Title, UserModelSnapshot, UserTitleState, Recommendation, ModelVersion, Triad]), PublicQualityModule, TrainingModule, ExperimentsModule],
  controllers: [RecommendationsController, LibraryController],
  providers: [RecommendationsService],
})
export class RecommendationsModule {}