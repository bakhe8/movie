import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrivacyRequest } from '../../entities/privacy-request.entity';
import { Profile } from '../../entities/profile.entity';
import { User } from '../../entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

// PRIVACY.md §5 rights: export, delete (scheduled, cancellable, purged by a
// job), reset taste; every action leaves a privacy_requests row and an
// audit_log row (ALPHA_PLAN phase 2, items 2.1 and 2.3).
@Module({
  imports: [TypeOrmModule.forFeature([User, Profile, PrivacyRequest]), AuditModule],
  controllers: [PrivacyController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
