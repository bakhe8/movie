import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { WatchEvent } from '../../entities/watch-event.entity';
import { UserTitleStateModule } from '../user-title-state/user-title-state.module';
import { WatchEventsController } from './watch-events.controller';
import { WatchEventsService } from './watch-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Title, Recommendation, WatchEvent, Outcome]), UserTitleStateModule],
  controllers: [WatchEventsController],
  providers: [WatchEventsService],
})
export class WatchEventsModule {}
