import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../../entities/profile.entity';
import { Triad } from '../../entities/triad.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { ModelServiceClient } from './model-service.client';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';
import { TriadCompletedSubscriber } from './triad-completed.subscriber';

// Backend side of ADR-25: asks the Python model service to train a profile
// (automatically after completed triads, or on the owner's request) and
// reports the job's state. Nothing here fits a model.
@Module({
  imports: [TypeOrmModule.forFeature([Profile, Triad, UserModelSnapshot])],
  controllers: [TrainingController],
  providers: [ModelServiceClient, TrainingService, TriadCompletedSubscriber],
  exports: [TrainingService],
})
export class TrainingModule {}
