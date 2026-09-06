import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { PublicationPolicyService } from './publication-policy.service';
import { PublicationPreviewController } from './publication-preview.controller';
import { PublicationPreviewService } from './publication-preview.service';

// PUB-S1 (ADR-118): schema (migration only, no entity registered yet -- see
// entities/title-revision.entity.ts), the public-v1 evaluator, and its
// admin read-only preview. Owned by the publishing-gate track (PUB-W0..J1),
// not by ADMIN-W1..W8: this module never imports admin.module.ts and admin
// files never import from here except to render what this returns.
@Module({
  imports: [TypeOrmModule.forFeature([Title, SourceRecord])],
  controllers: [PublicationPreviewController],
  providers: [PublicationPolicyService, PublicationPreviewService],
  exports: [PublicationPolicyService],
})
export class PublicationModule {}
