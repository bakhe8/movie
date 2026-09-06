import { Injectable } from '@nestjs/common';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';

export const PUBLICATION_POLICY_VERSION = 'public-v1';

export type PublicationBlockerCode =
  | 'POSTER_MISSING'
  | 'DESCRIPTION_MISSING'
  | 'GENRES_MISSING'
  | 'IDENTITY_UNRESOLVED'
  | 'LICENSE_BLOCKED';

export interface PublicationEvaluation {
  titleId: string;
  policyVersion: typeof PUBLICATION_POLICY_VERSION;
  blockerCodes: PublicationBlockerCode[];
  ready: boolean;
}

// PUB-S1 (ADR-118): the `public-v1` shadow evaluator. Reads a title's
// *current* row plus the source_records it cites -- it never reads or
// writes `title_revisions`, so nothing is snapshotted until PUB-B1, and it
// never touches `titles.publishedRevisionId`, which only PUB-G1 may set.
@Injectable()
export class PublicationPolicyService {
  evaluate(title: Title, citedSourceRecords: SourceRecord[]): PublicationEvaluation {
    const blockerCodes: PublicationBlockerCode[] = [];

    if (!title.posterPath) blockerCodes.push('POSTER_MISSING');
    if (!title.description?.trim()) blockerCodes.push('DESCRIPTION_MISSING');
    if (!title.genres || title.genres.length === 0) blockerCodes.push('GENRES_MISSING');

    // CAT-2/D1000 records develop in a staging record outside `titles`
    // entirely (owner decision 2026-09-06, SESSIONS.md §2) -- no row in
    // this table can be unresolved yet, so this never fires until PUB-B1
    // admits a staged record here with its identity status carried along.

    // `licenseStatus` alone never blocks display during the free launch
    // (ADR-72, DATA_LICENSING.md §0) -- only rights that have actually
    // expired do.
    const now = Date.now();
    const expired = citedSourceRecords.some(
      (record) => record.retentionUntil !== null && record.retentionUntil.getTime() < now,
    );
    if (expired) blockerCodes.push('LICENSE_BLOCKED');

    return {
      titleId: title.id,
      policyVersion: PUBLICATION_POLICY_VERSION,
      blockerCodes,
      ready: blockerCodes.length === 0,
    };
  }
}
