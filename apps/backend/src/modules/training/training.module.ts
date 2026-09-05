import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../../entities/profile.entity';
import { Triad } from '../../entities/triad.entity';
import { TrainingJob } from '../../entities/training-job.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { ModelServiceClient } from './model-service.client';
import { TrainingController } from './training.controller';
import { TrainingJobsService } from './training-jobs.service';
import { TrainingService } from './training.service';
import { TriadCompletedSubscriber } from './triad-completed.subscriber';

// Backend side of ADR-25: asks the Python model service to train a profile
// (automatically after completed triads, or on the owner's request) and
// reports the job's state. TrainingJobsService (ADR-100) is the durable
// outer layer -- exported so AdminModule can show its failures and read
// readiness without a second copy of the retry logic. Nothing here fits
// a model.
@Module({
  imports: [TypeOrmModule.forFeature([Profile, Triad, TrainingJob, UserModelSnapshot])],
  controllers: [TrainingController],
  providers: [ModelServiceClient, TrainingJobsService, TrainingService, TriadCompletedSubscriber],
  exports: [TrainingService, TrainingJobsService, ModelServiceClient],
})
export class TrainingModule {}
