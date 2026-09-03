import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { OutcomesController } from './outcomes.controller';
import { OutcomesService } from './outcomes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Recommendation, Outcome])],
  controllers: [OutcomesController],
  providers: [OutcomesService],
})
export class OutcomesModule {}
