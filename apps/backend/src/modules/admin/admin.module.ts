import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminJob } from '../../entities/admin-job.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { ContentFeature } from '../../entities/content-feature.entity';
import { Experiment } from '../../entities/experiment.entity';
import { ExperimentAssignment } from '../../entities/experiment-assignment.entity';
import { ModelVersion } from '../../entities/model-version.entity';
import { PrivacyRequest } from '../../entities/privacy-request.entity';
import { Profile } from '../../entities/profile.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { User } from '../../entities/user.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { AuditModule } from '../audit/audit.module';
import { TrainingModule } from '../training/training.module';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminJobsService } from './admin-jobs.service';
import { AdminMetricsService } from './admin-metrics.service';
import { AdminModelsService } from './admin-models.service';
import { AdminOpsService } from './admin-ops.service';
import { AdminController } from './admin.controller';

// Internal board (BP §5.1): catalog and rights, fingerprint review,
// models and experiments, accounts, privacy queue, audit log, and the
// metrics board (4.3). Backend half only; the screens are 4.2. TrainingModule
// (ADR-100) supplies TrainingJobsService and ModelServiceClient for the
// training-jobs summary and the readiness check.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Title,
      SourceRecord,
      ContentFeature,
      ModelVersion,
      UserModelSnapshot,
      Experiment,
      ExperimentAssignment,
      Triad,
      User,
      Profile,
      RefreshToken,
      PrivacyRequest,
      AuditLog,
      AdminJob,
    ]),
    AuditModule,
    TrainingModule,
  ],
  controllers: [AdminController],
  providers: [AdminCatalogService, AdminModelsService, AdminOpsService, AdminMetricsService, AdminJobsService],
})
export class AdminModule {}
