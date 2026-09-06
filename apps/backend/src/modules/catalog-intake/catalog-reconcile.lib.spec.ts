import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../../scripts/seed-demo.lib';
import { reconcileCatalog, type ReconcileTitleRow } from './catalog-reconcile.lib';

function entry(overrides: Partial<CatalogEntry> & { internalId: string }): CatalogEntry {
  return {
    titleEn: 'A Film',
    titleAr: 'فيلم',
    description: 'English lead.',
    descriptionSource: 'wikipedia:en',
    descriptionAr: 'مقدمة عربية.',
    releaseYear: 2000,
    genres: ['Drama', 'Crime'],
    originalLanguage: 'ar',
    externalIds: { wikidata: 'Q1', imdb: 'tt0000001', tmdb: '1' },
    posterPath: '/p.jpg',
    fingerprint: null,
    ...overrides,
  };
}

function row(overrides: Partial<ReconcileTitleRow> & { internalId: string }): ReconcileTitleRow {
  return {
    titleEn: 'A Film',
    titleAr: 'فيلم',
    description: 'English lead.',
    releaseYear: 2000,
    genres: ['Crime', 'Drama'],
    originalLanguage: 'ar',
    posterPath: '/p.jpg',
    externalIds: { wikidata: 'Q1', imdb: 'tt0000001', tmdb: '1' },
    ...overrides,
  };
}

describe('reconcileCatalog', () => {
  it('reports no drift when the database matches what the seed would write, ignoring genre order', () => {
    const report = reconcileCatalog([entry({ internalId: 'DEMO0001' })], [row({ internalId: 'DEMO0001' })]);
    expect(report).toMatchObject({ fixtureEntries: 1, titlesExamined: 1, matched: 1, fixtureOnly: [], databaseOnly: [], driftTotal: 0, drift: [], driftByField: {} });
  });

  it('lists every differing field with both values and counts per field', () => {
    const report = reconcileCatalog(
      [entry({ internalId: 'DEMO0001', posterPath: null }), entry({ internalId: 'DEMO0002', externalIds: { wikidata: 'Q2', imdb: 'tt0000002' } })],
      [row({ internalId: 'DEMO0001', titleAr: 'عنوان آخر' }), row({ internalId: 'DEMO0002', externalIds: { wikidata: 'Q2', imdb: 'tt0000002', tmdb: '2' } })],
    );
    expect(report.driftTotal).toBe(3);
    expect(report.driftByField).toEqual({ titleAr: 1, posterPath: 1, 'externalIds.tmdb': 1 });
    expect(report.drift).toEqual([
      { internalId: 'DEMO0001', field: 'titleAr', fixture: 'فيلم', database: 'عنوان آخر' },
      { internalId: 'DEMO0001', field: 'posterPath', fixture: null, database: '/p.jpg' },
      { internalId: 'DEMO0002', field: 'externalIds.tmdb', fixture: null, database: '2' },
    ]);
  });

  it("reads the fixture with the seed's own rules: a Wikidata stub description yields the Arabic lead", () => {
    const stub = entry({ internalId: 'DEMO0001', description: '1958 film', descriptionSource: 'wikidata' });
    expect(reconcileCatalog([stub], [row({ internalId: 'DEMO0001', description: 'مقدمة عربية.' })]).driftTotal).toBe(0);
    expect(reconcileCatalog([stub], [row({ internalId: 'DEMO0001', description: '1958 film' })]).driftByField).toEqual({ description: 1 });
  });

  it('separates fixture-only and database-only works and caps the listed drift', () => {
    const fixture = [entry({ internalId: 'DEMO0001' }), entry({ internalId: 'DEMO0002' })];
    const titles = [row({ internalId: 'DEMO0001', titleEn: 'x', titleAr: 'y', description: 'z' }), row({ internalId: 'FILM001' })];
    const report = reconcileCatalog(fixture, titles, 2);
    expect(report.fixtureOnly).toEqual(['DEMO0002']);
    expect(report.databaseOnly).toEqual(['FILM001']);
    expect(report.driftTotal).toBe(3);
    expect(report.drift).toHaveLength(2);
  });
});
