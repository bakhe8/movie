import { Module } from '@nestjs/common';
import { ExperimentsModule } from '../experiments/experiments.module';
import { PublicQualityModule } from '../public-quality/public-quality.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from '../analytics/analytics.module';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { TriadReplacement } from '../../entities/triad-replacement.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { Credit } from '../../entities/credit.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { WatchEvent } from '../../entities/watch-event.entity';
import { TriadsController } from './triads.controller';
import { TriadPolicyService } from './triad-policy.service';
import { TriadsService } from './triads.service';

@Module({
  imports: [
    AnalyticsModule,
    TypeOrmModule.forFeature([Profile, Title, Triad, TriadReplacement, UserTitleState, WatchEvent, Recommendation, Outcome, UserModelSnapshot, Credit]),
    PublicQualityModule,
    ExperimentsModule,
  ],
  controllers: [TriadsController],
  providers: [TriadsService, TriadPolicyService],
})
export class TriadsModule {}