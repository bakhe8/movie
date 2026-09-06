import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getConnectionOptions } from '../src/config/database.config';
import { SourceRecord } from '../src/entities/source-record.entity';
import { Title } from '../src/entities/title.entity';
import { TitlePoster } from '../src/entities/title-poster.entity';
import { backfillTitlePosters, POSTER_BACKFILL_EXTRACTOR_VERSION, type TmdbPosterImage } from '../src/scripts/fetch-tmdb-posters';
import { TMDB_ATTRIBUTION } from '../src/scripts/load-catalog-rights';

// POSTERS-MULTI P2 (ADR-120): against postgres-test with synthetic titles,
// never the shared dev database.
describe('backfillTitlePosters (postgres-test)', () => {
  let dataSource: DataSource;
  const suffix = Date.now();

  beforeAll(async () => {
    dataSource = new DataSource({ ...getConnectionOptions(), synchronize: false });
    await dataSource.initialize();
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  const titlesRepository = () => dataSource.getRepository(Title);
  const titlePostersRepository = () => dataSource.getRepository(TitlePoster);
  const sourceRecordsRepository = () => dataSource.getRepository(SourceRecord);

  function fakeFetcher(byTmdbId: Record<string, TmdbPosterImage[] | null>): (tmdbId: string) => Promise<TmdbPosterImage[] | null> {
    return async (tmdbId: string) => (tmdbId in byTmdbId ? byTmdbId[tmdbId] : null);
  }

  it('writes title_posters + source_records, current poster first, rest by vote_average descending', async () => {
    const internalId = `E2E-POSTERS-FULL-${suffix}`;
    const tmdbId = `${suffix}1`; // CHK_titles_tmdb_identity requires a bare numeric id
    const title = await titlesRepository().save(
      titlesRepository().create({ internalId, titleEn: 'Full', titleAr: 'كامل', posterPath: '/current.jpg', externalIds: { tmdb: tmdbId } }),
    );

    const images: TmdbPosterImage[] = [
      { file_path: '/low.jpg', vote_average: 3 },
      { file_path: '/high.jpg', vote_average: 9 },
      { file_path: '/current.jpg', vote_average: 1 }, // TMDB also returns the current poster -- must not duplicate it
    ];

    const summary = await backfillTitlePosters(dataSource, { fetchImages: fakeFetcher({ [tmdbId]: images }), only: new Set([internalId]) });
    expect(summary).toMatchObject({ titlesConsidered: 1, titlesBackfilled: 1, postersInserted: 3, sourceRecordsInserted: 3 });

    const rows = await titlePostersRepository().find({ where: { titleId: title.id }, order: { sortOrder: 'ASC' } });
    expect(rows.map((r) => ({ posterPath: r.posterPath, sortOrder: r.sortOrder }))).toEqual([
      { posterPath: '/current.jpg', sortOrder: 0 },
      { posterPath: '/high.jpg', sortOrder: 1 },
      { posterPath: '/low.jpg', sortOrder: 2 },
    ]);
    expect(rows.every((r) => r.sourceRecordId !== null)).toBe(true);

    const rights = await sourceRecordsRepository().find({ where: { titleId: title.id, extractorVersion: POSTER_BACKFILL_EXTRACTOR_VERSION } });
    expect(rights).toHaveLength(3);
    expect(rights.every((r) => r.licenseStatus === 'non_commercial_only' && r.source === 'tmdb' && r.license === TMDB_ATTRIBUTION)).toBe(true);
    expect(new Set(rights.map((r) => r.value))).toEqual(
      new Set(['https://image.tmdb.org/t/p/original/current.jpg', 'https://image.tmdb.org/t/p/original/high.jpg', 'https://image.tmdb.org/t/p/original/low.jpg']),
    );
  });

  it('is idempotent: a second run with the same images inserts nothing new', async () => {
    const internalId = `E2E-POSTERS-IDEMPOTENT-${suffix}`;
    const tmdbId = `${suffix}2`;
    await titlesRepository().save(titlesRepository().create({ internalId, titleEn: 'Again', titleAr: 'مرة أخرى', posterPath: null, externalIds: { tmdb: tmdbId } }));
    const images: TmdbPosterImage[] = [{ file_path: '/x.jpg', vote_average: 5 }];
    const fetchImages = fakeFetcher({ [tmdbId]: images });

    const first = await backfillTitlePosters(dataSource, { fetchImages, only: new Set([internalId]) });
    expect(first).toMatchObject({ titlesBackfilled: 1, postersInserted: 1 });

    // Without --force a title with any title_posters row is skipped outright.
    const second = await backfillTitlePosters(dataSource, { fetchImages, only: new Set([internalId]) });
    expect(second).toMatchObject({ titlesConsidered: 1, titlesAlreadyBackfilled: 1, titlesBackfilled: 0, postersInserted: 0 });

    // Forcing a re-run over the same images inserts no duplicate row (orIgnore on the unique constraint) and reuses the rights row.
    const third = await backfillTitlePosters(dataSource, { fetchImages, only: new Set([internalId]), force: true });
    expect(third).toMatchObject({ titlesBackfilled: 1, postersInserted: 0, sourceRecordsInserted: 0 });
  });

  it('skips a title with no TMDB id, and reports a failed TMDB request without writing anything', async () => {
    const noTmdb = `E2E-POSTERS-NO-TMDB-${suffix}`;
    const failed = `E2E-POSTERS-FAILED-${suffix}`;
    await titlesRepository().save(titlesRepository().create({ internalId: noTmdb, titleEn: 'No TMDB', titleAr: 'بلا تي إم دي بي', externalIds: {} }));
    const failedTitle = await titlesRepository().save(
      titlesRepository().create({ internalId: failed, titleEn: 'Failed', titleAr: 'فشل', externalIds: { tmdb: `${suffix}3` } }),
    );

    const summary = await backfillTitlePosters(dataSource, {
      fetchImages: fakeFetcher({}), // every id "not found" -> null
      only: new Set([noTmdb, failed]),
    });
    expect(summary).toMatchObject({ titlesConsidered: 2, titlesWithoutTmdbId: 1, titlesRequestFailed: [failed], postersInserted: 0 });
    expect(await titlePostersRepository().count({ where: { titleId: failedTitle.id } })).toBe(0);
  });

  it('caps at the given limit and never fabricates a poster when TMDB has none', async () => {
    const internalId = `E2E-POSTERS-LIMIT-${suffix}`;
    const tmdbId = `${suffix}4`;
    const title = await titlesRepository().save(
      titlesRepository().create({ internalId, titleEn: 'Limit', titleAr: 'حد', posterPath: null, externalIds: { tmdb: tmdbId } }),
    );
    const images: TmdbPosterImage[] = Array.from({ length: 6 }, (_, i) => ({ file_path: `/img${i}.jpg`, vote_average: i }));

    const summary = await backfillTitlePosters(dataSource, { fetchImages: fakeFetcher({ [tmdbId]: images }), only: new Set([internalId]), limit: 2 });
    expect(summary).toMatchObject({ postersInserted: 2 });
    expect(await titlePostersRepository().count({ where: { titleId: title.id } })).toBe(2);
  });

  it('dry run writes nothing', async () => {
    const internalId = `E2E-POSTERS-DRY-${suffix}`;
    const tmdbId = `${suffix}5`;
    const title = await titlesRepository().save(
      titlesRepository().create({ internalId, titleEn: 'Dry', titleAr: 'جاف', posterPath: null, externalIds: { tmdb: tmdbId } }),
    );
    const images: TmdbPosterImage[] = [{ file_path: '/x.jpg', vote_average: 5 }];

    const summary = await backfillTitlePosters(dataSource, { fetchImages: fakeFetcher({ [tmdbId]: images }), only: new Set([internalId]), dryRun: true });
    expect(summary).toMatchObject({ titlesBackfilled: 1, postersInserted: 1 });
    expect(await titlePostersRepository().count({ where: { titleId: title.id } })).toBe(0);
  });
});
