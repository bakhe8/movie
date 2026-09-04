import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Experiment } from '../../entities/experiment.entity';
import { ExperimentAssignment } from '../../entities/experiment-assignment.entity';
import { ExperimentsService } from './experiments.service';

// ALPHA_PLAN 6.5: reads the `experiments` table (M4) so a policy can ship
// behind a flag with a control arm. No routes -- the admin board already
// lists experiments; this is the read other modules assign against.
@Module({
  imports: [TypeOrmModule.forFeature([Experiment, ExperimentAssignment])],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
