import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getConnectionOptions } from '../src/config/database.config';
import { SourceRecord } from '../src/entities/source-record.entity';
import { Title } from '../src/entities/title.entity';
import { EXTRACTOR_VERSION, loadCatalogRights, rowsFor, wikipediaUrl, type CatalogRightsEntry } from '../src/scripts/load-catalog-rights';

// ALPHA_PLAN 5.1: rights rows for the catalog's own fields. Against
// postgres-test with synthetic titles and fixture entries of our own.
describe('load-catalog-rights (postgres-test)', () => {
  let dataSource: DataSource;
  const suffix = Date.now();

  beforeAll(async () => {
    dataSource = new DataSource({ ...getConnectionOptions(), synchronize: false });
    await dataSource.initialize();
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  const full: CatalogRightsEntry = {
    internalId: `E2E-RIGHTS-FULL-${suffix}`,
    titleEn: 'Cairo Station',
    titleAr: 'باب الحديد',
    releaseYear: 1958,
    genres: ['Drama'],
    originalLanguage: 'ar',
    externalIds: { wikidata: 'Q765535', imdb: 'tt0051390' },
    descriptionSource: 'wikipedia:en',
    description: 'Cairo Station is a 1958 Egyptian film.',
    evidence: { wikipedia: { en: 'Cairo Station', ar: 'باب الحديد (فلم)' }, plotSource: 'wikipedia:en:Cairo Station' },
  };

  describe('rowsFor (pure)', () => {
    it('earns one CC0 Wikidata row per present fact, a CC BY-SA row for the lead and one for the plot evidence', () => {
      const rows = rowsFor(full);
      expect(rows.map((r) => `${r.fieldName}<-${r.source}`)).toEqual([
        'titleEn<-wikidata',
        'titleAr<-wikidata',
        'releaseYear<-wikidata',
        'genres<-wikidata',
        'originalLanguage<-wikidata',
        'externalIds<-wikidata',
        'description<-wikipedia:en',
        'enrichmentEvidence<-wikipedia:en',
      ]);
      const fact = rows[0];
      expect(fact).toMatchObject({ value: 'wikidata:Q765535', license: 'CC0 1.0', licenseStatus: 'commercial_allowed', attributionRequired: false });
      const lead = rows[6];
      expect(lead).toMatchObject({ value: wikipediaUrl('en', 'Cairo Station'), licenseStatus: 'commercial_allowed', attributionRequired: true, allowsDerivation: true });
      expect(lead.license).toContain('CC BY-SA 4.0');
    });

    it('never claims a row for an absent value, and credits a Wikidata-stub lead to Wikidata', () => {
      const rows = rowsFor({
        internalId: 'x',
        titleEn: 'Stub',
        titleAr: 'بديل',
        genres: [],
        originalLanguage: null,
        externalIds: { wikidata: 'Q1' },
        descriptionSource: 'wikidata',
        description: 'stub',
        evidence: { wikipedia: { en: null, ar: null }, plotSource: null },
      });
      expect(rows.map((r) => `${r.fieldName}<-${r.source}`)).toEqual(['titleEn<-wikidata', 'titleAr<-wikidata', 'externalIds<-wikidata', 'description<-wikidata']);
    });

    it('earns nothing without a Wikidata id or a page', () => {
      expect(rowsFor({ internalId: 'y', titleEn: 'Orphan', titleAr: 'يتيم', description: 'text', descriptionSource: 'wikipedia:en' })).toEqual([]);
    });

    it('builds a Wikipedia URL the way the site does', () => {
      expect(wikipediaUrl('en', 'The Night of Counting the Years')).toBe('https://en.wikipedia.org/wiki/The_Night_of_Counting_the_Years');
      expect(wikipediaUrl('ar', 'باب الحديد (فلم)')).toBe(`https://ar.wikipedia.org/wiki/${encodeURIComponent('باب_الحديد_(فلم)')}`);
    });
  });

  it('writes the rows for a loaded title, skips a fixture title not loaded, and is idempotent', async () => {
    const titlesRepository = dataSource.getRepository(Title);
    const title = await titlesRepository.save(titlesRepository.create({ internalId: full.internalId, titleEn: full.titleEn!, titleAr: full.titleAr! }));
    const entries: CatalogRightsEntry[] = [full, { ...full, internalId: `E2E-RIGHTS-MISSING-${suffix}` }];

    const first = await loadCatalogRights(dataSource, entries);
    expect(first).toMatchObject({ titlesMatched: 1, titlesNotYetLoaded: [`E2E-RIGHTS-MISSING-${suffix}`], rowsCreated: 8, rowsAlreadyLoaded: 0, titlesWithoutWikidataId: [] });

    const sourceRecordsRepository = dataSource.getRepository(SourceRecord);
    const rows = await sourceRecordsRepository.find({ where: { titleId: title.id, extractorVersion: EXTRACTOR_VERSION } });
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.licenseStatus === 'commercial_allowed' && r.reviewStatus === 'unreviewed' && r.retrievedAt !== null)).toBe(true);
    const lead = rows.find((r) => r.fieldName === 'description')!;
    expect(lead).toMatchObject({ source: 'wikipedia:en', value: 'https://en.wikipedia.org/wiki/Cairo_Station', attributionRequired: true });

    const again = await loadCatalogRights(dataSource, entries);
    expect(again).toMatchObject({ rowsCreated: 0, rowsAlreadyLoaded: 8 });
    expect(await sourceRecordsRepository.count({ where: { titleId: title.id } })).toBe(8);

    // The admin board's "missing rights" definition (a title with no row
    // whose status is known) no longer matches this title.
    const [{ missing }] = await dataSource.query(
      `SELECT NOT EXISTS (SELECT 1 FROM source_records sr WHERE sr."titleId" = $1 AND sr."licenseStatus" <> 'unknown') AS missing`,
      [title.id],
    );
    expect(missing).toBe(false);
  });

  it('dry run writes nothing', async () => {
    const titlesRepository = dataSource.getRepository(Title);
    const dry = { ...full, internalId: `E2E-RIGHTS-DRY-${suffix}` };
    const title = await titlesRepository.save(titlesRepository.create({ internalId: dry.internalId, titleEn: 'Dry', titleAr: 'جاف' }));

    const summary = await loadCatalogRights(dataSource, [dry], { dryRun: true });

    expect(summary.rowsCreated).toBe(8);
    expect(await dataSource.getRepository(SourceRecord).count({ where: { titleId: title.id } })).toBe(0);
  });
});
