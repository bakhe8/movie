import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getConnectionOptions } from '../src/config/database.config';
import { Credit } from '../src/entities/credit.entity';
import { Person } from '../src/entities/person.entity';
import { SourceRecord } from '../src/entities/source-record.entity';
import { Title } from '../src/entities/title.entity';
import { loadDirectorCredits, type TitleDirectorCredits } from '../src/scripts/load-director-credits';

// Blueprint gap 6's first real load into people/credits/source_records
// (ADR-65 staged the fetch; this joins it to real titles.id now that WS3
// has loaded the catalog). Against postgres-test with synthetic titles of
// our own -- never reads or depends on session C's 300-title fixture.
describe('load-director-credits (postgres-test)', () => {
  let dataSource: DataSource;
  const suffix = Date.now();

  beforeAll(async () => {
    dataSource = new DataSource({ ...getConnectionOptions(), synchronize: false });
    await dataSource.initialize();
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeTitle(internalId: string) {
    const titlesRepository = dataSource.getRepository(Title);
    return titlesRepository.save(titlesRepository.create({ internalId, titleEn: internalId, titleAr: internalId }));
  }

  it('matches by internalId, writes one credit + source_record per director, and skips a title not yet loaded', async () => {
    const solo = await makeTitle(`E2E-LDC-SOLO-${suffix}`);
    const co = await makeTitle(`E2E-LDC-CO-${suffix}`);

    const staged: TitleDirectorCredits[] = [
      {
        internalId: solo.internalId,
        titleWikidataId: 'Q1',
        directors: [{ wikidataId: `QDIR1-${suffix}`, nameEn: 'Solo Director', nameAr: 'مخرج منفرد', creditOrder: 0 }],
      },
      {
        internalId: co.internalId,
        titleWikidataId: 'Q2',
        directors: [
          { wikidataId: `QDIR2-${suffix}`, nameEn: 'First Director', nameAr: null, creditOrder: 0 },
          { wikidataId: `QDIR3-${suffix}`, nameEn: null, nameAr: 'مخرج ثانٍ', creditOrder: 1 },
        ],
      },
      // No matching title in the DB -- must be reported, not thrown.
      { internalId: `E2E-LDC-MISSING-${suffix}`, titleWikidataId: 'Q3', directors: [{ wikidataId: `QDIR4-${suffix}`, nameEn: 'Ghost', nameAr: null, creditOrder: 0 }] },
      // No director claim at all -- must write nothing and not count as matched-but-empty.
      { internalId: `E2E-LDC-NODIRECTOR-${suffix}`, titleWikidataId: 'Q4', directors: [] },
    ];

    const summary = await loadDirectorCredits(dataSource, staged);

    expect(summary).toMatchObject({
      titlesMatched: 2,
      titlesNotYetLoaded: [`E2E-LDC-MISSING-${suffix}`],
      creditsCreated: 3,
      creditsAlreadyLoaded: 0,
      peopleCreated: 3,
    });

    const creditsRepository = dataSource.getRepository(Credit);
    const sourceRecordsRepository = dataSource.getRepository(SourceRecord);
    const peopleRepository = dataSource.getRepository(Person);

    const soloCredits = await creditsRepository.find({ where: { titleId: solo.id } });
    expect(soloCredits).toHaveLength(1);
    expect(soloCredits[0]).toMatchObject({ role: 'director', creditOrder: 0 });
    const soloPerson = await peopleRepository.findOneByOrFail({ id: soloCredits[0].personId });
    expect(soloPerson).toMatchObject({ name: 'Solo Director', externalIds: { wikidata: `QDIR1-${suffix}` } });

    const soloSourceRecord = await sourceRecordsRepository.findOneByOrFail({ id: soloCredits[0].sourceRecordId! });
    expect(soloSourceRecord).toMatchObject({
      titleId: solo.id,
      fieldName: 'director',
      value: `QDIR1-${suffix}`,
      source: 'wikidata',
      license: 'CC0',
      licenseStatus: 'commercial_allowed',
      allowsStorage: true,
      allowsDerivation: true,
      allowsTraining: true,
      attributionRequired: false,
      reviewStatus: 'unreviewed',
    });

    // Co-directed title: two credits, order preserved, one director's name
    // falls back to the Arabic label when English is null (never fabricated).
    const coCredits = await creditsRepository.find({ where: { titleId: co.id }, order: { creditOrder: 'ASC' } });
    expect(coCredits).toHaveLength(2);
    expect(coCredits.map((credit) => credit.creditOrder)).toEqual([0, 1]);
    const secondDirector = await peopleRepository.findOneByOrFail({ id: coCredits[1].personId });
    expect(secondDirector.name).toBe('مخرج ثانٍ');
  });

  it('is idempotent: a second run creates nothing new and reuses the same person across titles', async () => {
    const titleA = await makeTitle(`E2E-LDC-DEDUP-A-${suffix}`);
    const titleB = await makeTitle(`E2E-LDC-DEDUP-B-${suffix}`);
    const staged: TitleDirectorCredits[] = [
      { internalId: titleA.internalId, titleWikidataId: 'Q10', directors: [{ wikidataId: `QDIR-SHARED-${suffix}`, nameEn: 'Shared Director', nameAr: null, creditOrder: 0 }] },
      { internalId: titleB.internalId, titleWikidataId: 'Q11', directors: [{ wikidataId: `QDIR-SHARED-${suffix}`, nameEn: 'Shared Director', nameAr: null, creditOrder: 0 }] },
    ];

    const first = await loadDirectorCredits(dataSource, staged);
    expect(first).toMatchObject({ creditsCreated: 2, peopleCreated: 1 }); // same director, one Person row for both titles

    const second = await loadDirectorCredits(dataSource, staged);
    expect(second).toMatchObject({ creditsCreated: 0, creditsAlreadyLoaded: 2, peopleCreated: 0, titlesMatched: 2 });

    const peopleRepository = dataSource.getRepository(Person);
    const matches = await peopleRepository
      .createQueryBuilder('person')
      .where(`person."externalIds"->>'wikidata' = :qid`, { qid: `QDIR-SHARED-${suffix}` })
      .getMany();
    expect(matches).toHaveLength(1);
  });

  it('dry-run writes nothing but reports what it would do', async () => {
    const title = await makeTitle(`E2E-LDC-DRYRUN-${suffix}`);
    const staged: TitleDirectorCredits[] = [
      { internalId: title.internalId, titleWikidataId: 'Q20', directors: [{ wikidataId: `QDIR-DRYRUN-${suffix}`, nameEn: 'Dry Run Director', nameAr: null, creditOrder: 0 }] },
    ];

    const summary = await loadDirectorCredits(dataSource, staged, { dryRun: true });
    expect(summary).toMatchObject({ creditsCreated: 1, titlesMatched: 1 });

    const creditsRepository = dataSource.getRepository(Credit);
    expect(await creditsRepository.find({ where: { titleId: title.id } })).toHaveLength(0);
    const peopleRepository = dataSource.getRepository(Person);
    const matches = await peopleRepository
      .createQueryBuilder('person')
      .where(`person."externalIds"->>'wikidata' = :qid`, { qid: `QDIR-DRYRUN-${suffix}` })
      .getMany();
    expect(matches).toHaveLength(0);
  });

  it('a dry-run against an already-loaded director correctly previews "already loaded", not "would create"', async () => {
    const title = await makeTitle(`E2E-LDC-DRYRUN-EXISTING-${suffix}`);
    const staged: TitleDirectorCredits[] = [
      { internalId: title.internalId, titleWikidataId: 'Q21', directors: [{ wikidataId: `QDIR-DRYRUN-EXISTING-${suffix}`, nameEn: 'Already Loaded Director', nameAr: null, creditOrder: 0 }] },
    ];

    await loadDirectorCredits(dataSource, staged); // real run first
    const secondSummary = await loadDirectorCredits(dataSource, staged, { dryRun: true });

    expect(secondSummary).toMatchObject({ creditsCreated: 0, creditsAlreadyLoaded: 1, peopleCreated: 0 });
  });
});
