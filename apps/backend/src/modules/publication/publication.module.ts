import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { TitleRevision } from '../../entities/title-revision.entity';
import { PublicationPolicyService } from './publication-policy.service';
import { PublicationPreviewController } from './publication-preview.controller';
import { PublicationPreviewService } from './publication-preview.service';

// PUB-W0/S1/G1-guard (ADR-118): schema, the public-v1 evaluator, blocker
// codes, and its admin read-only preview -- NOT yet connected to any public
// read path. Owner decision 2026-09-06 (PUB-G1 scope review): build the
// guard/evaluator in full, but wiring it into titles/recommendations/
// triads/state/watch-events, and any mechanism that sets
// `titles.publishedRevisionId`, waits for board 1D-9 (manual publish with
// transaction-lock/expectedRevision/audit), done explicitly and separately.
// `PublicationGuard`/`wherePublished`-style helpers must NOT be imported by
// any consumer service until that gate is opened.
@Module({
  imports: [TypeOrmModule.forFeature([Title, SourceRecord, TitleRevision])],
  controllers: [PublicationPreviewController],
  providers: [PublicationPolicyService, PublicationPreviewService],
  exports: [PublicationPolicyService],
})
export class PublicationModule {}
