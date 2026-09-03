import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { UserTitleStateController } from './user-title-state.controller';
import { UserTitleStateService } from './user-title-state.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Title, UserTitleState])],
  controllers: [UserTitleStateController],
  providers: [UserTitleStateService],
  // WatchEventsService reuses upsert() rather than duplicating its PATCH
  // semantics (M1) for marking a title watched (BP §4.5's "returns to
  // appropriate triads" step).
  exports: [UserTitleStateService],
})
export class UserTitleStateModule {}