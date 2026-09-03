import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { TriadReplacement } from '../../entities/triad-replacement.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { TriadsController } from './triads.controller';
import { TriadsService } from './triads.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Title, Triad, TriadReplacement, UserTitleState])],
  controllers: [TriadsController],
  providers: [TriadsService],
})
export class TriadsModule {}