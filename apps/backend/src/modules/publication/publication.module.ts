import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { TitleRevision } from '../../entities/title-revision.entity';
import { AuditModule } from '../audit/audit.module';
import { PublicationPolicyService } from './publication-policy.service';
import { PublicationPreviewController } from './publication-preview.controller';
import { PublicationPreviewService } from './publication-preview.service';
import { PublishTitleController } from './publish-title.controller';
import { PublishTitleService } from './publish-title.service';

// PUB-W0/S1/G1/1D-9 (ADR-118): schema, the public-v1 evaluator, blocker
// codes, its admin read-only preview, and the manual-publish transaction
// that is the ONLY place allowed to set `titles.publishedRevisionId`
// (`PublishTitleService`, board 1D-9 -- row lock + expectedRevision +
// in-transaction re-evaluation + audit + readback).
//
// PUB-G1's guard (`publication-guard.ts`, `wherePublished`/
// `PUBLISHED_TITLE_WHERE`) is still NOT wired into any consumer read path
// (owner decision 2026-09-06): `PublishTitleService` sets the pointer this
// gate will use, but no search/recommendations/triads/state/watch-events
// path reads it yet. Wiring those is a separate, explicit follow-up.
@Module({
  imports: [TypeOrmModule.forFeature([Title, SourceRecord, TitleRevision]), AuditModule],
  controllers: [PublicationPreviewController, PublishTitleController],
  providers: [PublicationPolicyService, PublicationPreviewService, PublishTitleService],
  exports: [PublicationPolicyService],
})
export class PublicationModule {}
