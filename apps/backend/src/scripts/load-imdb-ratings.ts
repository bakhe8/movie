/**
 * Load IMDb ratings from the official non-commercial dataset dump
 * (`title.ratings.tsv.gz`, https://datasets.imdbws.com/) into
 * `public_quality_sources`, one row per title with a rights-registry row per
 * value (ALPHA_PLAN 5.3; owner decision 2026-09-04: IMDb's free datasets are
 * the Public Quality source through the free launch, DATA_LICENSING.md §3.2).
 *
 *   npm run build && node dist/scripts/load-imdb-ratings.js [--file <path>] [--fetch] [--dry-run]
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
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
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
  return filePath.endsWith('.gz') ? file.pipe(createGunzip()) : file;
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

  const summary: LoadImdbRatingsSummary = { titlesWithImdbId: titles.length, notInDump: [], created: 0, unchanged: 0, superseded: 0 };

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
function defaultDumpPath(): string {
  const dir = process.env.IMDB_DATASETS_DIR || path.join(tmpdir(), 'movie-imdb-datasets');
  return path.join(dir, 'title.ratings.tsv.gz');
}

async function fetchDump(url: string, target: string): Promise<void> {
  mkdirSync(path.dirname(target), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileIndex = args.indexOf('--file');
  const filePath = fileIndex !== -1 && args[fileIndex + 1] ? path.resolve(args[fileIndex + 1]) : defaultDumpPath();

  if (args.includes('--fetch')) {
    const url = process.env.IMDB_RATINGS_URL || IMDB_RATINGS_URL;
    console.log(`Downloading ${url} -> ${filePath}`);
    await fetchDump(url, filePath);
  }
  if (!existsSync(filePath)) {
    throw new Error(`Dump not found: ${filePath} (pass --fetch to download it from ${IMDB_RATINGS_URL})`);
  }
  const capturedAt = statSync(filePath).mtime;

  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  try {
    const wanted = new Set<string>(
      (
        await dataSource
          .getRepository(Title)
          .createQueryBuilder('title')
          .select(`title."externalIds"->>'imdb'`, 'imdb')
          .where(`title."externalIds"->>'imdb' IS NOT NULL`)
          .getRawMany<{ imdb: string }>()
      ).map((row) => row.imdb),
    );
    console.log(`Reading ${filePath} (dated ${capturedAt.toISOString()}) for ${wanted.size} IMDb id(s)...`);
    const ratings = await parseRatings(openDump(filePath), wanted);
    console.log(`${ratings.size} of them found in the dump.`);

    const summary = await loadImdbRatings(dataSource, ratings, { capturedAt, dryRun, log: (line) => console.log(`  ${line}`) });
    console.log(
      `\n${dryRun ? '[dry run] would write' : 'Wrote'} ${summary.created} rating(s) for ${summary.titlesWithImdbId} title(s) with an IMDb id ` +
        `(${summary.unchanged} unchanged, ${summary.superseded} superseded).`,
    );
    if (summary.notInDump.length > 0) {
      console.log(
        `${summary.notInDump.length} title(s) with an IMDb id are not in the dump (no value written): ` +
          summary.notInDump.slice(0, 10).join(', ') +
          (summary.notInDump.length > 10 ? ', ...' : ''),
      );
    }
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
