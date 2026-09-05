/**
 * Load IMDb ratings from the official non-commercial dataset dump
 * (`title.ratings.tsv.gz`, https://datasets.imdbws.com/) into
 * `public_quality_sources`, one row per title with a rights-registry row per
 * value (ALPHA_PLAN 5.3; owner decision 2026-09-04: IMDb's free datasets are
 * the Public Quality source through the free launch, DATA_LICENSING.md §3.2).
 *
 *   npm run build && node dist/scripts/load-imdb-ratings.js [--file <path>] [--fetch] [--dry-run]
 *
 * The same pass also runs inside the app on a schedule when
 * IMDB_REFRESH_INTERVAL_HOURS is set (modules/public-quality/
 * public-quality-refresh.service.ts), so Public Quality stays a living
 * value rather than a one-off snapshot.
 *
 * (compiled, not `tsx`: same DataSource/decorator-metadata reason as
 * load-director-credits.ts and seed-demo.ts.)
 *
 * Input : the dump, gzipped or plain TSV (`tconst  averageRating  numVotes`).
 *         Default path $IMDB_DATASETS_DIR/title.ratings.tsv.gz (default dir:
 *         <os tmp>/movie-imdb-datasets, never inside the repo); `--fetch`
 *         downloads it there first from IMDB_RATINGS_URL (default: the
 *         official URL) -- the dataset endpoint, never an imdb.com page.
 * Reads : titles that carry `externalIds.imdb` (tconst). Titles without one
 *         are outside this loader's job; titles with one that the dump does
 *         not list (too few votes, or a wrong id) are reported, never given a
 *         made-up value (BP §11.3).
 * Writes: source_records (fieldName 'publicQuality', source 'imdb',
 *         licenseStatus 'non_commercial_only', attributionRequired,
 *         retrievedAt = the dump's date) and public_quality_sources (source
 *         'imdb', value on the 0-10 scale, votes, capturedAt = the dump's date).
 *
 * Idempotent and append-only: an unchanged (rating, votes) pair for a title
 * is skipped; a changed one gets a new pair of rows and the previous registry
 * row's `supersededBy` points at the new one (BP §11.3: corrections are new
 * rows, never overwrites). Nothing else is touched; titles are read-only.
 */
import 'reflect-metadata';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { PublicQualitySource } from '../entities/public-quality-source.entity';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';
import { IMDB_LICENSE, IMDB_SCALE, IMDB_SOURCE } from '../modules/public-quality/public-quality.constants';
import { captureException } from '../observability/observability';

export const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
export const EXTRACTOR_VERSION = 'load-imdb-ratings-v1';

export interface ImdbRating {
  rating: number;
  votes: number;
}

export interface LoadImdbRatingsSummary {
  titlesWithImdbId: number;
  notInDump: string[];
  created: number;
  unchanged: number;
  superseded: number;
  // true when this pass fell back to a previous dump because a fresh
  // download failed or did not validate (P0-4) -- the loaded values are
  // still whatever the last good dump held, just not as fresh as intended.
  stale: boolean;
}

export interface LoadImdbRatingsOptions {
  // The dump's own date (its mtime, or the download time): stamped as
  // capturedAt/retrievedAt so a later dump is a later snapshot.
  capturedAt: Date;
  dryRun?: boolean;
  log?: (line: string) => void;
}

// Streams the dump and keeps only the tconsts asked for -- the full file is
// ~1.5 M rows, the catalog a few hundred. Header line is skipped; malformed
// lines are skipped, never guessed.
export async function parseRatings(input: NodeJS.ReadableStream, wanted: ReadonlySet<string>): Promise<Map<string, ImdbRating>> {
  const ratings = new Map<string, ImdbRating>();
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.startsWith('tconst')) {
      continue;
    }
    const [tconst, ratingText, votesText] = line.split('\t');
    if (!tconst || !wanted.has(tconst)) {
      continue;
    }
    const rating = Number(ratingText);
    const votes = Number(votesText);
    if (!Number.isFinite(rating) || !Number.isInteger(votes) || rating < 0 || rating > 10 || votes < 0) {
      continue;
    }
    ratings.set(tconst, { rating, votes });
  }
  return ratings;
}

export function openDump(filePath: string): NodeJS.ReadableStream {
  const file = createReadStream(filePath);
  // Strip a `.part` suffix before checking for `.gz`: validateDump reads the
  // downloaded file at its temporary `<target>.part` path (P0-4), which
  // would otherwise never look gzipped no matter what `target` itself is.
  const withoutPartSuffix = filePath.endsWith('.part') ? filePath.slice(0, -'.part'.length) : filePath;
  return withoutPartSuffix.endsWith('.gz') ? file.pipe(createGunzip()) : file;
}

export async function loadImdbRatings(
  dataSource: DataSource,
  ratingsByTconst: ReadonlyMap<string, ImdbRating>,
  options: LoadImdbRatingsOptions,
): Promise<LoadImdbRatingsSummary> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});
  const titlesRepository = dataSource.getRepository(Title);
  const qualityRepository = dataSource.getRepository(PublicQualitySource);

  const titles = await titlesRepository
    .createQueryBuilder('title')
    .select(['title.id', 'title.internalId', 'title.externalIds'])
    .where(`title."externalIds"->>'imdb' IS NOT NULL`)
    .getMany();

  const summary: LoadImdbRatingsSummary = {
    titlesWithImdbId: titles.length,
    notInDump: [],
    created: 0,
    unchanged: 0,
    superseded: 0,
    stale: false,
  };

  for (const title of titles) {
    const tconst = title.externalIds?.imdb;
    const rating = tconst ? ratingsByTconst.get(tconst) : undefined;
    if (!tconst || !rating) {
      summary.notInDump.push(title.internalId);
      continue;
    }

    const latest = await qualityRepository.findOne({
      where: { titleId: title.id, source: IMDB_SOURCE },
      order: { capturedAt: 'DESC' },
    });
    // `value` is a Postgres real (float4): compare with a tolerance rather
    // than bit-for-bit, so a re-run of the same dump is a no-op.
    if (latest && latest.value !== null && Math.abs(latest.value - rating.rating) < 1e-6 && latest.votes === rating.votes) {
      summary.unchanged += 1;
      continue;
    }

    log(`${title.internalId} ${tconst}: ${rating.rating} (${rating.votes} votes)${latest ? ` replaces ${latest.value} (${latest.votes})` : ''}`);
    if (dryRun) {
      summary.created += 1;
      if (latest) {
        summary.superseded += 1;
      }
      continue;
    }

    await dataSource.transaction(async (manager) => {
      const sourceRecord = await manager.save(
        manager.create(SourceRecord, {
          titleId: title.id,
          fieldName: 'publicQuality',
          value: `${rating.rating}|${rating.votes}`,
          source: IMDB_SOURCE,
          license: IMDB_LICENSE,
          licenseStatus: 'non_commercial_only',
          allowsStorage: true,
          // A rating is shown as a separate Public Quality value; it is never
          // a taste feature or a training input (BP §6, §10.2).
          allowsDerivation: false,
          allowsTraining: false,
          attributionRequired: true,
          fallbackPlan: 'commercial license via AWS Data Exchange at the revenue-model study, or drop the IMDb values (DATA_LICENSING.md §3.2)',
          extractorVersion: EXTRACTOR_VERSION,
          reviewStatus: 'unreviewed',
          retrievedAt: options.capturedAt,
          validFrom: options.capturedAt,
        }),
      );
      await manager.save(
        manager.create(PublicQualitySource, {
          titleId: title.id,
          source: IMDB_SOURCE,
          market: null,
          value: rating.rating,
          scale: IMDB_SCALE,
          votes: rating.votes,
          polarization: null,
          capturedAt: options.capturedAt,
          sourceRecordId: sourceRecord.id,
        }),
      );
      if (latest) {
        await manager.update(SourceRecord, { id: latest.sourceRecordId }, { supersededBy: sourceRecord.id });
        summary.superseded += 1;
      }
    });
    summary.created += 1;
  }

  return summary;
}

// Like fetch-catalog.ts's CATALOG_CACHE_DIR: the dump is a ~7 MB download
// that must never enter git, so it lives under the OS temp dir unless
// IMDB_DATASETS_DIR says otherwise.
export function defaultDumpPath(): string {
  const dir = process.env.IMDB_DATASETS_DIR || path.join(tmpdir(), 'movie-imdb-datasets');
  return path.join(dir, 'title.ratings.tsv.gz');
}

// The official dataset endpoint, never an imdb.com page (DATA_LICENSING.md §3.2).
// Writes straight to `target`; callers that must not clobber a known-good
// file on a failed download use fetchDumpAtomic below instead.
export async function fetchDump(url: string, target: string): Promise<void> {
  mkdirSync(path.dirname(target), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
}

// P0-4: a dump that decompresses to an HTML error page, a truncated body
// (connection dropped mid-download), or an empty file must never be told
// apart from a real one by size or extension alone -- this actually streams
// it and checks the header line and a row-count floor. The real dataset is
// multiple MB and well over a million rows; either check catches a dump
// this loader has no business acting on.
export interface DumpValidation {
  ok: boolean;
  reason?: string;
  lineCount?: number;
}

const MIN_DUMP_BYTES = 1_000_000;
const MIN_DUMP_LINES = 100_000;
const EXPECTED_HEADER = 'tconst\taverageRating\tnumVotes';
// Below this, a structurally valid dump is still suspicious enough to alert
// on (checked against the catalog's own titles, not the dump's total size).
const MIN_DUMP_COVERAGE = 0.4;

export interface ValidateDumpOptions {
  // Overridable so tests can exercise the size/line-count floors without
  // gzipping a multi-MB fixture; production always uses the real floors.
  minBytes?: number;
  minLines?: number;
}

export async function validateDump(filePath: string, options: ValidateDumpOptions = {}): Promise<DumpValidation> {
  const minBytes = options.minBytes ?? MIN_DUMP_BYTES;
  const minLines = options.minLines ?? MIN_DUMP_LINES;
  const size = statSync(filePath).size;
  if (size < minBytes) {
    return { ok: false, reason: `only ${size} byte(s) on disk (expected at least ${minBytes})` };
  }
  let lineCount = 0;
  let sawExpectedHeader = false;
  try {
    const lines = createInterface({ input: openDump(filePath), crlfDelay: Infinity });
    for await (const line of lines) {
      if (lineCount === 0) {
        sawExpectedHeader = line.startsWith(EXPECTED_HEADER);
      }
      lineCount += 1;
    }
  } catch (error) {
    // A truncated gzip stream throws mid-decompression -- exactly the
    // "downloaded a partial file" case this exists to catch.
    return { ok: false, reason: `could not read as gzip/TSV: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!sawExpectedHeader) {
    return { ok: false, reason: 'first line is not the expected tconst/averageRating/numVotes header' };
  }
  if (lineCount < minLines) {
    return { ok: false, reason: `only ${lineCount} row(s) (expected at least ${minLines}) -- looks truncated` };
  }
  return { ok: true, lineCount };
}

export interface FetchDumpResult {
  // false when the download or its validation failed and a previous good
  // copy was kept at `target` instead of being overwritten by a partial or
  // corrupt one.
  replaced: boolean;
  stale: boolean;
  reason?: string;
}

// Downloads to `${target}.part`, validates it, and only then renames it onto
// `target` -- a rename on the same filesystem is atomic, so a reader of
// `target` (this same process on its next scheduled pass, or a concurrent
// one) always sees either the complete old file or the complete new one,
// never a half-written one. A failed download or a dump that fails
// validation deletes the `.part` file and falls back to whatever is already
// at `target`; that fallback is reported (`stale: true`) and sent to Sentry,
// but it is not thrown -- a bad IMDb dataset dump must not take the app or
// its deploy down with it. Only when there is no previous file at all (a
// fresh environment's first run) does this rethrow: at that point there is
// truly nothing to load.
export async function fetchDumpAtomic(url: string, target: string, validation: ValidateDumpOptions = {}): Promise<FetchDumpResult> {
  const partPath = `${target}.part`;
  mkdirSync(path.dirname(target), { recursive: true });
  const hadPrevious = existsSync(target);

  try {
    await fetchDump(url, partPath);
    const validated = await validateDump(partPath, validation);
    if (!validated.ok) {
      throw new Error(`downloaded IMDb dump failed validation: ${validated.reason}`);
    }
  } catch (error) {
    rmSync(partPath, { force: true });
    if (hadPrevious) {
      captureException(error, { job: 'imdb-dump-download' });
      return { replaced: false, stale: true, reason: error instanceof Error ? error.message : String(error) };
    }
    throw error;
  }

  renameSync(partPath, target);
  return { replaced: true, stale: false };
}

export async function wantedTconsts(dataSource: DataSource): Promise<Set<string>> {
  const rows = await dataSource
    .getRepository(Title)
    .createQueryBuilder('title')
    .select(`title."externalIds"->>'imdb'`, 'imdb')
    .where(`title."externalIds"->>'imdb' IS NOT NULL`)
    .getRawMany<{ imdb: string }>();
  return new Set(rows.map((row) => row.imdb));
}

export interface RefreshImdbRatingsOptions {
  filePath?: string;
  // Download the dump first (to filePath) from IMDB_RATINGS_URL.
  fetch?: boolean;
  dryRun?: boolean;
  log?: (line: string) => void;
}

// One complete pass: (download,) parse for the catalog's ids, load. Shared
// by the CLI below and by the in-app periodic refresh
// (modules/public-quality/public-quality-refresh.service.ts).
export async function refreshImdbRatings(dataSource: DataSource, options: RefreshImdbRatingsOptions = {}): Promise<LoadImdbRatingsSummary> {
  const log = options.log ?? (() => {});
  const filePath = options.filePath ?? defaultDumpPath();
  let stale = false;
  if (options.fetch) {
    const url = process.env.IMDB_RATINGS_URL || IMDB_RATINGS_URL;
    log(`Downloading ${url} -> ${filePath}`);
    const result = await fetchDumpAtomic(url, filePath);
    stale = result.stale;
    if (stale) {
      log(`Download/validation failed (${result.reason}) -- falling back to the previous dump on disk (stale).`);
    }
  }
  if (!existsSync(filePath)) {
    throw new Error(`Dump not found: ${filePath} (pass --fetch to download it from ${IMDB_RATINGS_URL})`);
  }
  const capturedAt = statSync(filePath).mtime;

  const wanted = await wantedTconsts(dataSource);
  log(`Reading ${filePath} (dated ${capturedAt.toISOString()}) for ${wanted.size} IMDb id(s)...`);
  const ratings = await parseRatings(openDump(filePath), wanted);
  log(`${ratings.size} of them found in the dump.`);

  // A structurally valid dump that suddenly covers far fewer of the
  // catalog's own titles than before is a data-quality signal worth an
  // alert (a format change IMDb made, a wrong id mapping) even though it is
  // not corrupt enough for validateDump to have rejected it outright.
  const coverage = wanted.size > 0 ? ratings.size / wanted.size : 1;
  if (wanted.size >= 20 && coverage < MIN_DUMP_COVERAGE) {
    const reason = `IMDb dump covers only ${Math.round(coverage * 100)}% of ${wanted.size} catalog title(s) with an IMDb id`;
    log(`WARNING: ${reason}.`);
    captureException(new Error(reason), { job: 'imdb-dump-coverage' });
  }

  const summary = await loadImdbRatings(dataSource, ratings, { capturedAt, dryRun: options.dryRun, log: (line) => log(`  ${line}`) });
  summary.stale = stale;
  log(
    `${options.dryRun ? '[dry run] would write' : 'Wrote'} ${summary.created} rating(s) for ${summary.titlesWithImdbId} title(s) with an IMDb id ` +
      `(${summary.unchanged} unchanged, ${summary.superseded} superseded)${stale ? ' [stale dump]' : ''}.`,
  );
  if (summary.notInDump.length > 0) {
    log(
      `${summary.notInDump.length} title(s) with an IMDb id are not in the dump (no value written): ` +
        summary.notInDump.slice(0, 10).join(', ') +
        (summary.notInDump.length > 10 ? ', ...' : ''),
    );
  }
  return summary;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const filePath = fileIndex !== -1 && args[fileIndex + 1] ? path.resolve(args[fileIndex + 1]) : undefined;

  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  try {
    await refreshImdbRatings(dataSource, {
      filePath,
      fetch: args.includes('--fetch'),
      dryRun: args.includes('--dry-run'),
      log: (line) => console.log(line),
    });
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
