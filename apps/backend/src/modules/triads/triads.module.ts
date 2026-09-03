import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { TriadReplacement } from '../../entities/triad-replacement.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { TriadsController } from './triads.controller';
import { TriadsService } from './triads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Profile, Title, Triad, TriadReplacement, UserTitleState, Recommendation, Outcome]),
  ],
  controllers: [TriadsController],
  providers: [TriadsService],
})
export class TriadsModule {}