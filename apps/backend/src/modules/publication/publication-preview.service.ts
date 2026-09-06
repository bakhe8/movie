import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import {
  PUBLICATION_POLICY_VERSION,
  PublicationBlockerCode,
  PublicationEvaluation,
  PublicationPolicyService,
} from './publication-policy.service';

export interface PublicationShadowReport {
  policyVersion: typeof PUBLICATION_POLICY_VERSION;
  totalTitles: number;
  readyCount: number;
  blockerCounts: Partial<Record<PublicationBlockerCode, number>>;
  titles: PublicationEvaluation[];
}

// PUB-S1: the admin-only, read-only shadow report. It never writes
// `title_revisions` or `titles.publishedRevisionId` -- only a preview of
// what `public-v1` would decide today, over the whole current catalog.
// Loading every title and source_record unpaginated is fine at the current
// ~389-title scale; PUB-B1 batches this once CAT-2's staged records land.
@Injectable()
export class PublicationPreviewService {
  constructor(
    @InjectRepository(Title) private readonly titles: Repository<Title>,
    @InjectRepository(SourceRecord) private readonly sourceRecords: Repository<SourceRecord>,
    private readonly policy: PublicationPolicyService,
  ) {}

  async shadowReport(): Promise<PublicationShadowReport> {
    const [titles, sourceRecords] = await Promise.all([this.titles.find(), this.sourceRecords.find()]);

    const byTitleId = new Map<string, SourceRecord[]>();
    for (const record of sourceRecords) {
      if (!record.titleId) continue;
      const bucket = byTitleId.get(record.titleId);
      if (bucket) bucket.push(record);
      else byTitleId.set(record.titleId, [record]);
    }

    const evaluations = titles.map((title) => this.policy.evaluate(title, byTitleId.get(title.id) ?? []));

    const blockerCounts: Partial<Record<PublicationBlockerCode, number>> = {};
    for (const evaluation of evaluations) {
      for (const code of evaluation.blockerCodes) {
        blockerCounts[code] = (blockerCounts[code] ?? 0) + 1;
      }
    }

    return {
      policyVersion: PUBLICATION_POLICY_VERSION,
      totalTitles: evaluations.length,
      readyCount: evaluations.filter((evaluation) => evaluation.ready).length,
      blockerCounts,
      titles: evaluations,
    };
  }
}
