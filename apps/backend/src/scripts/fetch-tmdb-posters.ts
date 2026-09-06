/**
 * Poster path for the demo catalog, via the official TMDB API (board C-2,
 * archive B4) -- never scraping. One call per title with `externalIds.tmdb`
 * to `GET /movie/{id}`, through the same on-disk cache as the other fixture
 * fetches, so a re-run is offline and only new/forced titles cost a request.
 *
 *   cd apps/backend && npx tsx src/scripts/fetch-tmdb-posters.ts [--force] [--only DEMO0001,DEMO0002]
 *
 * Writes `entry.posterPath` on the fixture entry: TMDB's own relative path
 * (e.g. "/abc123.jpg"), or `null` when TMDB has none for that title -- never
 * a composed display URL (that belongs to whoever exposes it on
 * `PublicTitle`, gated by the current license environment, board M1) and
 * never the image itself. `load-catalog-rights.ts` writes the accompanying
 * `source_records` row for every title this leaves with a path.
 *
 * POSTERS-MULTI P2 (ADR-120) adds a second, DB-backed mode: `--backfill-db`
 * fills `title_posters` from TMDB's `GET /movie/{id}/images` instead, up to
 * `--limit` (default 4) posters per title, reading titles from the database
 * -- not this file's fixture, which stays session C's and is never a source
 * of truth here.
 *
 *   cd apps/backend && npx tsx src/scripts/fetch-tmdb-posters.ts --backfill-db [--force] [--only DEMO0001,DEMO0002] [--limit 4]
 */
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import path from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';

import { DatabaseConfig } from '../config/database.config';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';
import { TitlePoster } from '../entities/title-poster.entity';
import { tmdbPosterRow } from './load-catalog-rights';
import { CACHE_DIR, cachedGet } from './wiki-http';
import {
  needsPoster,
  parsePosterImages,
  parsePosterResponse,
  selectPosterRows,
  type PosterEntry,
  type TmdbPosterImage,
} from './fetch-tmdb-posters.lib';

config({ path: resolve(process.cwd(), '../../.env') });

const DEFAULT_FIXTURE = path.resolve(__dirname, 'fixtures', 'catalog.demo.json');
const DEFAULT_POSTER_LIMIT = 4;
// Distinct from load-catalog-rights.ts's own EXTRACTOR_VERSION: these rows
// describe extra images that script never saw, and must not be mistaken for
// its (titleId, extractorVersion) rows when it re-checks what is loaded.
export const POSTER_BACKFILL_EXTRACTOR_VERSION = 'fetch-tmdb-posters-backfill-v1';

function parseArgs(argv: string[]): { fixture: string; force: boolean; only: Set<string> | null; backfillDb: boolean; limit: number } {
  const args = { fixture: DEFAULT_FIXTURE, force: false, only: null as Set<string> | null, backfillDb: false, limit: DEFAULT_POSTER_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixture') {
      args.fixture = path.resolve(argv[++index]);
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--only') {
      args.only = new Set(argv[++index].split(',').map((value) => value.trim()).filter(Boolean));
    } else if (arg === '--backfill-db') {
      args.backfillDb = true;
    } else if (arg === '--limit') {
      args.limit = Number(argv[++index]);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

export interface BackfillTitle {
  id: string;
  internalId: string;
  posterPath: string | null;
  externalIds: { tmdb?: string } | null;
}

export interface BackfillTitlePostersOptions {
  limit?: number;
  force?: boolean;
  only?: Set<string> | null;
  dryRun?: boolean;
  log?: (line: string) => void;
  /** Injected so tests never make a network call; the real one wraps `cachedGet`. */
  fetchImages: (tmdbId: string) => Promise<TmdbPosterImage[] | null>;
}

export interface BackfillTitlePostersSummary {
  titlesConsidered: number;
  titlesWithoutTmdbId: number;
  titlesAlreadyBackfilled: number;
  titlesBackfilled: number;
  titlesRequestFailed: string[];
  postersInserted: number;
  sourceRecordsInserted: number;
}

/**
 * Fills `title_posters` (ADR-120) from TMDB's `/movie/{id}/images`, up to
 * `options.limit` posters per title (default 4). Read side is the database,
 * never `catalog.demo.json`: a title with no TMDB id or already backfilled
 * (has any `title_posters` row, unless `--force`) is skipped. Idempotent --
 * `orIgnore()` on `title_posters`' own `UNIQUE(titleId, posterPath)` means a
 * re-run (or a retry after a crash mid-title) can never duplicate a row.
 *
 * Each selected image gets its own `source_records` row via the same
 * `tmdbPosterRow()` shape `load-catalog-rights.ts` uses for the title's
 * single poster (same `non_commercial_only` licence claim) -- reused, not
 * duplicated, by exact `value` match, so the image `titles.posterPath`
 * already carries keeps its existing rights row instead of gaining a
 * second one.
 */
export async function backfillTitlePosters(dataSource: DataSource, options: BackfillTitlePostersOptions): Promise<BackfillTitlePostersSummary> {
  const limit = options.limit ?? DEFAULT_POSTER_LIMIT;
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const log = options.log ?? (() => {});

  const titlesRepository = dataSource.getRepository(Title);
  const titlePostersRepository = dataSource.getRepository(TitlePoster);

  const titles = (await titlesRepository.find({
    select: { id: true, internalId: true, posterPath: true, externalIds: true },
  })) as unknown as BackfillTitle[];

  const summary: BackfillTitlePostersSummary = {
    titlesConsidered: 0,
    titlesWithoutTmdbId: 0,
    titlesAlreadyBackfilled: 0,
    titlesBackfilled: 0,
    titlesRequestFailed: [],
    postersInserted: 0,
    sourceRecordsInserted: 0,
  };

  for (const title of titles) {
    if (options.only && !options.only.has(title.internalId)) {
      continue;
    }
    summary.titlesConsidered += 1;

    const tmdbId = title.externalIds?.tmdb;
    if (!tmdbId) {
      summary.titlesWithoutTmdbId += 1;
      continue;
    }

    if (!force) {
      const existingCount = await titlePostersRepository.count({ where: { titleId: title.id } });
      if (existingCount > 0) {
        summary.titlesAlreadyBackfilled += 1;
        continue;
      }
    }

    const images = await options.fetchImages(tmdbId);
    if (images === null) {
      summary.titlesRequestFailed.push(title.internalId);
      continue;
    }

    const rows = selectPosterRows(title.posterPath, images, limit);
    if (rows.length === 0) {
      continue;
    }
    log(`${title.internalId}: ${rows.map((row) => `${row.sortOrder}:${row.posterPath}`).join(', ')}`);
    summary.titlesBackfilled += 1;
    if (dryRun) {
      summary.postersInserted += rows.length;
      continue;
    }

    await dataSource.transaction(async (manager) => {
      const titlePosters = manager.getRepository(TitlePoster);
      const sourceRecords = manager.getRepository(SourceRecord);

      for (const row of rows) {
        const rightsRow = tmdbPosterRow(row.posterPath); // always a concrete https:// value, never null
        let sourceRecord = await sourceRecords.findOne({
          where: { titleId: title.id, fieldName: rightsRow.fieldName, source: rightsRow.source, value: rightsRow.value as string },
          select: { id: true },
        });
        if (!sourceRecord) {
          sourceRecord = await sourceRecords.save(
            sourceRecords.create({
              ...rightsRow,
              titleId: title.id,
              extractorVersion: POSTER_BACKFILL_EXTRACTOR_VERSION,
              reviewStatus: 'unreviewed',
              retrievedAt: new Date(),
              validFrom: new Date(),
            }),
          );
          summary.sourceRecordsInserted += 1;
        }

        // Checked ahead of the insert rather than counted off `InsertResult`:
        // with `orIgnore()`, TypeORM still reports a generated identifier for
        // a row Postgres actually skipped on the unique-constraint conflict,
        // which would over-count here even though no duplicate row exists.
        const alreadyExists = await titlePosters.exist({ where: { titleId: title.id, posterPath: row.posterPath } });
        await titlePosters
          .createQueryBuilder()
          .insert()
          .values({ titleId: title.id, posterPath: row.posterPath, sortOrder: row.sortOrder, sourceRecordId: sourceRecord.id })
          .orIgnore()
          .execute();
        if (!alreadyExists) {
          summary.postersInserted += 1;
        }
      }
    });
  }

  return summary;
}

async function runBackfillDb(args: { force: boolean; only: Set<string> | null; limit: number }): Promise<void> {
  const readToken = process.env.TMDB_READ_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!readToken && !apiKey) {
    console.error('TMDB_READ_ACCESS_TOKEN (preferred, sent as a header) or TMDB_API_KEY (v3, query string only) is required (root .env)');
    process.exit(2);
  }

  const fetchImages = async (tmdbId: string): Promise<TmdbPosterImage[] | null> => {
    const base = `https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}/images`;
    const url = readToken ? base : `${base}?api_key=${apiKey}`;
    const { status, body } = await cachedGet(url, readToken ? { Authorization: `Bearer ${readToken}` } : {});
    return parsePosterImages(status, body);
  };

  console.log(`backfill title_posters: limit ${args.limit} per title, force=${args.force}, cache ${CACHE_DIR}`);
  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  try {
    const summary = await backfillTitlePosters(dataSource, {
      limit: args.limit,
      force: args.force,
      only: args.only,
      fetchImages,
      log: (line) => console.log(`  ${line}`),
    });
    console.log(
      `\nConsidered ${summary.titlesConsidered} title(s): ${summary.titlesBackfilled} backfilled, ${summary.titlesAlreadyBackfilled} already had posters, ` +
        `${summary.titlesWithoutTmdbId} without a TMDB id, ${summary.titlesRequestFailed.length} TMDB request(s) failed. ` +
        `Inserted ${summary.postersInserted} title_posters row(s) and ${summary.sourceRecordsInserted} new source_records row(s).`,
    );
    if (summary.titlesRequestFailed.length > 0) {
      console.log(`Request failed for: ${summary.titlesRequestFailed.slice(0, 10).join(', ')}${summary.titlesRequestFailed.length > 10 ? ', ...' : ''}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.backfillDb) {
    await runBackfillDb(args);
    return;
  }
  // TMDB accepts a v4 read access token as a bearer header on the v3
  // endpoints, and that is the form to use (P1-1): a key in the query string
  // is a key in the cache filename, in this script's own error text, and in
  // any log between here and TMDB. The older v3 key has no header form at
  // all, so it still goes in the query -- with a warning, so nobody assumes
  // the credential is being kept out of URLs when it is not.
  const readToken = process.env.TMDB_READ_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!readToken && !apiKey) {
    console.error('TMDB_READ_ACCESS_TOKEN (preferred, sent as a header) or TMDB_API_KEY (v3, query string only) is required (root .env)');
    process.exit(2);
  }
  if (!readToken) {
    console.warn('note: using the v3 TMDB_API_KEY, which TMDB only accepts in the query string; a v4 TMDB_READ_ACCESS_TOKEN travels in a header instead');
  }

  const raw = JSON.parse(await readFile(args.fixture, 'utf8')) as (PosterEntry & Record<string, unknown>)[] | { entries: (PosterEntry & Record<string, unknown>)[] };
  const entries = Array.isArray(raw) ? raw : raw.entries;
  const candidates = entries.filter((entry) => (!args.only || args.only.has(entry.internalId)) && needsPoster(entry, args.force));
  console.log(`posters: ${entries.length} entries in ${path.basename(args.fixture)}; ${candidates.length} need a poster path; cache ${CACHE_DIR}`);

  let found = 0;
  let none = 0;
  for (const entry of candidates) {
    const base = `https://api.themoviedb.org/3/movie/${encodeURIComponent(entry.externalIds!.tmdb!)}`;
    const url = readToken ? base : `${base}?api_key=${apiKey}`;
    const { status, body } = await cachedGet(url, readToken ? { Authorization: `Bearer ${readToken}` } : {});
    entry.posterPath = parsePosterResponse(status, body);
    if (entry.posterPath) {
      found += 1;
    } else {
      none += 1;
    }
  }

  const output = Array.isArray(raw) ? entries : { ...raw, entries };
  await writeFile(args.fixture, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const withoutTmdb = entries.filter((entry) => !entry.externalIds?.tmdb).length;
  const withPoster = entries.filter((entry) => typeof entry.posterPath === 'string').length;
  const reportPath = args.fixture.replace(/\.json$/, '.posters-report.md');
  await writeFile(
    reportPath,
    [
      '# Demo catalog — TMDB poster paths',
      '',
      `Generated by \`src/scripts/fetch-tmdb-posters.ts\` on ${new Date().toISOString().slice(0, 10)} (TMDB API, never scraping).`,
      `Entries: ${entries.length} · with a TMDB id: ${entries.length - withoutTmdb} · fetched this run: ${candidates.length} (${found} with a poster, ${none} without) · with a poster path overall: ${withPoster} · no TMDB id at all: ${withoutTmdb}.`,
      '',
      '## Rules',
      '',
      '- `posterPath` is TMDB\'s own relative path, never a composed URL and never the image bytes.',
      '- No poster path is invented: a 404 or a null `poster_path` from TMDB is stored as `null`, not retried as a failure.',
      '- Attribution and license status are recorded once per title by `load-catalog-rights.ts` (`fieldName: posterPath`, `source: tmdb`, `non_commercial_only`).',
      '',
      withoutTmdb === 0
        ? 'Every title has a TMDB id.'
        : `Titles with no TMDB id (${withoutTmdb}): ${entries.filter((entry) => !entry.externalIds?.tmdb).map((entry) => entry.internalId).join(', ')}`,
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`  ${found} fetched with a poster, ${none} fetched with none, ${withPoster} total with a path → ${path.basename(reportPath)}`);
}

// Guarded like load-catalog-rights.ts: this file is now also imported (not
// just run) -- by the P2 backfill's own e2e spec, and by anything else that
// wants `backfillTitlePosters` -- and an unconditional call here made every
// such import run the fixture-writing CLI flow as a side effect (it did,
// once, discovered by that spec's own import).
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
