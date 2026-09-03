import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { getConnectionOptions } from '../src/config/database.config';
import { PublicQualitySource } from '../src/entities/public-quality-source.entity';
import { SourceRecord } from '../src/entities/source-record.entity';
import { Title } from '../src/entities/title.entity';
import { ATTRIBUTION_BY_SOURCE, IMDB_SOURCE } from '../src/modules/public-quality/public-quality.constants';
import { PublicQualityService } from '../src/modules/public-quality/public-quality.service';
import { loadImdbRatings, openDump, parseRatings } from '../src/scripts/load-imdb-ratings';

// ALPHA_PLAN 5.3: IMDb's official ratings dump -> public_quality_sources with
// a rights-registry row per value, then read back with attribution through
// PublicQualityService (what GET /titles/:id returns). Against postgres-test
// with synthetic titles and a synthetic dump of our own -- never the real
// catalog, never the network.
describe('load-imdb-ratings (postgres-test)', () => {
  let dataSource: DataSource;
  const suffix = Date.now();
  // tconsts that cannot collide with anything real: IMDb ids are tt + digits.
  const ttA = `tt9${suffix}1`;
  const ttB = `tt9${suffix}2`;
  const ttMissing = `tt9${suffix}3`;

  beforeAll(async () => {
    dataSource = new DataSource({ ...getConnectionOptions(), synchronize: false });
    await dataSource.initialize();
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeTitle(internalId: string, imdb: string | null) {
    const repository = dataSource.getRepository(Title);
    return repository.save(repository.create({ internalId, titleEn: internalId, titleAr: internalId, externalIds: imdb ? { imdb } : undefined }));
  }

  const dumpText = ['tconst\taverageRating\tnumVotes', `${ttA}\t7.8\t1200`, `${ttB}\t6.1\t40`, 'tt0000001\t5.7\t2000', `ttBAD\tnot-a-number\t1`].join('\n');

  it('parses a gzipped dump keeping only the wanted ids and skipping malformed lines', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'imdb-ratings-'));
    const file = path.join(dir, 'title.ratings.tsv.gz');
    writeFileSync(file, gzipSync(Buffer.from(dumpText)));

    const ratings = await parseRatings(openDump(file), new Set([ttA, ttB, ttMissing, 'ttBAD']));

    expect([...ratings.entries()]).toEqual([
      [ttA, { rating: 7.8, votes: 1200 }],
      [ttB, { rating: 6.1, votes: 40 }],
    ]);
  });

  it('writes one value + registry row per matched title, reports ids not in the dump, is idempotent, and supersedes on change', async () => {
    const a = await makeTitle(`E2E-IMDB-A-${suffix}`, ttA);
    const b = await makeTitle(`E2E-IMDB-B-${suffix}`, ttB);
    const missing = await makeTitle(`E2E-IMDB-MISSING-${suffix}`, ttMissing);
    await makeTitle(`E2E-IMDB-NOID-${suffix}`, null);

    const capturedAt = new Date('2026-09-04T12:00:00Z');
    const ratings = await parseRatings(Readable.from([dumpText]), new Set([ttA, ttB, ttMissing]));

    const first = await loadImdbRatings(dataSource, ratings, { capturedAt });
    // Other e2e files (and real data) may leave titles with IMDb ids around;
    // count only what this test can own.
    expect(first.created).toBeGreaterThanOrEqual(2);
    expect(first.notInDump).toContain(missing.internalId);
    expect(first.superseded).toBe(0);

    const qualityRepository = dataSource.getRepository(PublicQualitySource);
    const sourceRecordsRepository = dataSource.getRepository(SourceRecord);

    const rowA = await qualityRepository.findOneByOrFail({ titleId: a.id, source: IMDB_SOURCE });
    expect(rowA).toMatchObject({ value: 7.8, scale: '0-10', votes: 1200, market: null, polarization: null });
    expect(rowA.capturedAt.toISOString()).toBe(capturedAt.toISOString());
    const recordA = await sourceRecordsRepository.findOneByOrFail({ id: rowA.sourceRecordId });
    expect(recordA).toMatchObject({
      titleId: a.id,
      fieldName: 'publicQuality',
      value: '7.8|1200',
      source: IMDB_SOURCE,
      licenseStatus: 'non_commercial_only',
      allowsStorage: true,
      allowsDerivation: false,
      allowsTraining: false,
      attributionRequired: true,
      supersededBy: null,
    });
    expect(await qualityRepository.count({ where: { titleId: missing.id } })).toBe(0);

    // Same dump again: nothing new.
    const again = await loadImdbRatings(dataSource, ratings, { capturedAt });
    expect(again.created).toBe(0);
    expect(again.unchanged).toBeGreaterThanOrEqual(2);
    expect(await qualityRepository.count({ where: { titleId: a.id } })).toBe(1);

    // A later dump with a changed value for A: a new row, the old registry
    // row superseded (never overwritten), B untouched.
    const later = new Date('2026-10-01T12:00:00Z');
    const changed = new Map(ratings);
    changed.set(ttA, { rating: 8.1, votes: 1500 });
    const third = await loadImdbRatings(dataSource, changed, { capturedAt: later });
    expect(third.created).toBeGreaterThanOrEqual(1);
    expect(third.superseded).toBeGreaterThanOrEqual(1);

    const rowsA = await qualityRepository.find({ where: { titleId: a.id }, order: { capturedAt: 'ASC' } });
    expect(rowsA.map((r) => [r.value, r.votes])).toEqual([
      [7.8, 1200],
      [8.1, 1500],
    ]);
    const oldRecord = await sourceRecordsRepository.findOneByOrFail({ id: rowsA[0].sourceRecordId });
    expect(oldRecord.supersededBy).toBe(rowsA[1].sourceRecordId);
    expect(oldRecord.value).toBe('7.8|1200');
    expect(await qualityRepository.count({ where: { titleId: b.id } })).toBe(1);

    // Read side: the newest value with the required attribution; nothing for
    // the title the dump did not list.
    const service = new PublicQualityService(qualityRepository, sourceRecordsRepository);
    const byTitle = await service.forTitles([a.id, b.id, missing.id]);
    expect(byTitle.get(a.id)).toEqual({
      value: 8.1,
      votes: 1500,
      sources: [{ source: IMDB_SOURCE, value: 8.1, scale: '0-10', votes: 1500, capturedAt: later.toISOString(), attribution: ATTRIBUTION_BY_SOURCE[IMDB_SOURCE] }],
    });
    expect(byTitle.get(b.id)?.value).toBe(6.1);
    expect(byTitle.has(missing.id)).toBe(false);
  });

  it('dry run writes nothing', async () => {
    const c = await makeTitle(`E2E-IMDB-DRY-${suffix}`, `tt9${suffix}4`);
    const ratings = new Map([[`tt9${suffix}4`, { rating: 9, votes: 5 }]]);

    const summary = await loadImdbRatings(dataSource, ratings, { capturedAt: new Date(), dryRun: true });

    expect(summary.created).toBeGreaterThanOrEqual(1);
    expect(await dataSource.getRepository(PublicQualitySource).count({ where: { titleId: c.id } })).toBe(0);
  });
});
