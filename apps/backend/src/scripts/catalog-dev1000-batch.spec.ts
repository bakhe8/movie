import { describe, expect, it } from 'vitest';
import { buildBatchRecords, dedupeCandidates, nextInternalIds, parseCandidatesTsv, type CandidateRow, type ResolvedCandidate } from './catalog-dev1000-batch.lib';
import type { Dev1000Record } from './catalog-dev1000.lib';
import type { SourceReservation } from './catalog-identity';

const tsv = ['qid\tslice\tregion_hint\ttitle_en\tyear\timdb\tsitelinks\treason', 'Q1\tafrica\tBF\tWend Kuuni\t1982\ttt0084898\t9\treason one', 'Q2\tafrica\tBW\tThe Gods Must Be Crazy\t1980\ttt0080801\t49\treason two'].join('\n');

describe('D1000-2 batch candidate pipeline', () => {
  it('parses the tab-separated candidate pool', () => {
    const rows = parseCandidatesTsv(tsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ qid: 'Q1', slice: 'africa', regionHint: 'BF', titleEn: 'Wend Kuuni', year: 1982, imdb: 'tt0084898', sitelinks: 9, reason: 'reason one' });
  });
  it('rejects an unexpected header', () => {
    expect(() => parseCandidatesTsv('qid\tfoo\n')).toThrow('unexpected candidates.tsv header');
  });

  const existing: SourceReservation[] = [{ internalId: 'DEMO0001', wiki: 'en:X', titleEn: 'X', year: 2000, externalIds: { wikidata: 'Q1', imdb: 'tt0000001', tmdb: '1' } }];

  it('drops a candidate already reserved by wikidata or imdb, and de-dupes within the pool', () => {
    const candidates: CandidateRow[] = [
      { qid: 'Q1', slice: 's', regionHint: 'X', titleEn: 'X', year: 2000, imdb: 'tt9999999', sitelinks: 1, reason: 'r' },
      { qid: 'Q2', slice: 's', regionHint: 'X', titleEn: 'Y', year: 2001, imdb: 'tt0000001', sitelinks: 1, reason: 'r' },
      { qid: 'Q3', slice: 's', regionHint: 'X', titleEn: 'Z', year: 2002, imdb: 'tt0000003', sitelinks: 1, reason: 'r' },
      { qid: 'Q3', slice: 's', regionHint: 'X', titleEn: 'Z again', year: 2002, imdb: 'tt0000004', sitelinks: 1, reason: 'r' },
    ];
    const result = dedupeCandidates(existing, candidates);
    expect(result.fresh.map((r) => r.qid)).toEqual(['Q3']);
    expect(result.droppedAsExisting).toHaveLength(2);
    expect(result.droppedAsDuplicateWithinBatch.map((r) => r.qid)).toEqual(['Q3']);
  });

  it('assigns contiguous internalIds after the current maximum', () => {
    expect(nextInternalIds(existing, 3)).toEqual(['DEMO0002', 'DEMO0003', 'DEMO0004']);
  });

  it('builds records with STAGED_NEW status and rejects a collision against the reserved set', () => {
    const baseline = existing as Dev1000Record[];
    const resolved: ResolvedCandidate[] = [{ qid: 'Q9', slice: 's', regionHint: 'X', titleEn: 'New Film', year: 2020, imdb: 'tt0009999', sitelinks: 5, reason: 'r', wiki: 'en:New_Film', tmdb: '555' }];
    const records = buildBatchRecords(baseline, resolved);
    expect(records).toEqual([{ internalId: 'DEMO0002', wiki: 'en:New_Film', titleEn: 'New Film', year: 2020, externalIds: { wikidata: 'Q9', imdb: 'tt0009999', tmdb: '555' }, devStatus: 'STAGED_NEW' }]);

    const colliding: ResolvedCandidate[] = [{ ...resolved[0], qid: 'Q1' }];
    expect(() => buildBatchRecords(baseline, colliding)).toThrow('collision');
  });

  it('carries an imdbMismatch note into blockReason when the resolver flags one', () => {
    const baseline = existing as Dev1000Record[];
    const resolved: ResolvedCandidate[] = [{ qid: 'Q9', slice: 's', regionHint: 'X', titleEn: 'New Film', year: 2020, imdb: 'tt0009999', sitelinks: 5, reason: 'r', wiki: 'en:New_Film', imdbMismatch: 'Wikidata P345 disagrees with the pool imdb id' }];
    const records = buildBatchRecords(baseline, resolved);
    expect(records[0].blockReason).toBe('Wikidata P345 disagrees with the pool imdb id');
    expect(records[0].externalIds.tmdb).toBeUndefined();
  });
});
