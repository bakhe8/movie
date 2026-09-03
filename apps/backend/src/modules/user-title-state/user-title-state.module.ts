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
})
export class UserTitleStateModule {}