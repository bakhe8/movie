import { describe, expect, it } from 'vitest';
import { verifyCatalog, type VerifyTitleRow } from './catalog-verify.lib';

function title(overrides: Partial<VerifyTitleRow> & { internalId: string }): VerifyTitleRow {
  return {
    id: `id-${overrides.internalId}`,
    titleEn: 'A Film',
    titleAr: 'فيلم',
    description: 'A description.',
    releaseYear: 2000,
    genres: ['Drama'],
    posterPath: '/p.jpg',
    externalIds: { wikidata: 'Q1', imdb: 'tt0000001', tmdb: '1' },
    fingerprint: { v2: {} },
    ...overrides,
  };
}

const rights = (titleId: string, fieldName: string, retentionUntil: Date | null = null) => ({ titleId, fieldName, source: 'wikidata', retentionUntil });

describe('verifyCatalog', () => {
  const reserved = [
    { internalId: 'DEMO0001', externalIds: { wikidata: 'Q1', imdb: 'tt0000001', tmdb: '1' } },
    { internalId: 'DEMO0002', externalIds: { wikidata: 'Q2', imdb: 'tt0000002', tmdb: '2' } },
    { internalId: 'DEMO0003', externalIds: { wikidata: 'Q3' } },
  ];

  it('counts admissible and blocked titles with per-code totals and a sample', () => {
    const titles = [
      title({ internalId: 'DEMO0001' }),
      title({ internalId: 'DEMO0002', externalIds: { wikidata: 'Q2', imdb: 'tt0000002', tmdb: '2' }, posterPath: null, fingerprint: null }),
    ];
    const rows = ['titleEn', 'titleAr', 'releaseYear', 'genres', 'description', 'posterPath'].map((field) => rights('id-DEMO0001', field));
    const report = verifyCatalog({ titles, sourceRecords: rows, reserved });
    expect(report.titlesExamined).toBe(2);
    expect(report.admissible).toBe(1);
    expect(report.blocked).toBe(1);
    expect(report.byCode).toEqual({ POSTER_MISSING: 1, FINGERPRINT_MISSING: 1 });
    expect(report.sample).toEqual([{ internalId: 'DEMO0002', blockerCodes: ['POSTER_MISSING', 'FINGERPRINT_MISSING'] }]);
  });

  it('reconciles the admitted set against the reservations without touching either', () => {
    const titles = [
      title({ internalId: 'DEMO0001' }),
      title({ internalId: 'DEMO0002', externalIds: { wikidata: 'Q2', imdb: 'tt0000002', tmdb: '99' } }),
      title({ internalId: 'FILM001', externalIds: { wikidata: 'Q50' } }),
    ];
    const report = verifyCatalog({ titles, sourceRecords: [], reserved });
    expect(report.reservation.reserved).toBe(3);
    expect(report.reservation.reservedNotAdmitted).toEqual(['DEMO0003']);
    expect(report.reservation.admittedNotReserved).toEqual(['FILM001']);
    expect(report.reservation.bindingMismatches).toEqual([{ internalId: 'DEMO0002', provider: 'tmdb', reserved: '2', admitted: '99' }]);
  });

  it('reports rights-registry gaps per field, titles with no row at all, and expired rights', () => {
    const titles = [title({ internalId: 'DEMO0001' }), title({ internalId: 'DEMO0002', externalIds: { wikidata: 'Q2' }, posterPath: null })];
    const rows = [rights('id-DEMO0001', 'titleEn'), rights('id-DEMO0001', 'posterPath', new Date('2020-01-01T00:00:00Z'))];
    const report = verifyCatalog({ titles, sourceRecords: rows, reserved, now: new Date('2026-09-06T00:00:00Z') });
    expect(report.provenance.titlesWithoutAnyRow).toBe(1);
    expect(report.provenance.titlesWithExpiredRights).toBe(1);
    expect(report.provenance.fieldsWithoutRow).toEqual({ titleEn: 1, titleAr: 2, releaseYear: 2, genres: 2, description: 2 });
  });

  it('summarizes the dev1000 staging record and flags staged works whose ids are already admitted', () => {
    const titles = [title({ internalId: 'DEMO0001' })];
    const staging = [
      { internalId: 'DEMO0001', wiki: 'en:A', titleEn: 'A', year: 2000, externalIds: { wikidata: 'Q1' }, devStatus: 'BASELINE_389' as const },
      { internalId: 'DEMO0500', wiki: 'en:B', titleEn: 'B', year: 2001, externalIds: { wikidata: 'Q500', imdb: 'tt0000001' }, devStatus: 'STAGED_NEW' as const },
      { internalId: 'DEMO0501', wiki: 'en:C', titleEn: 'C', year: 2002, externalIds: { wikidata: 'Q501' }, devStatus: 'INCOMPLETE' as const, blockReason: 'UNRESOLVED' },
    ];
    const report = verifyCatalog({ titles, sourceRecords: [], reserved, staging });
    expect(report.staging).toEqual({ records: 3, byDevStatus: { BASELINE_389: 1, STAGED_NEW: 1, INCOMPLETE: 1 }, stagedAlreadyAdmitted: ['DEMO0500'] });
  });

  it('is null for staging when none was supplied', () => {
    expect(verifyCatalog({ titles: [], sourceRecords: [], reserved: [] }).staging).toBeNull();
  });
});
