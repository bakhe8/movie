/**
 * Rights-registry rows for the catalog's own fields (ALPHA_PLAN 5.1,
 * DATA_LICENSING.md §0/§6.1): every value the demo catalog shows or feeds to
 * the enrichment gets a `source_records` row naming its source and license,
 * so no title is left at `unknown`. Also the poster path `fetch-tmdb-posters.ts`
 * writes (board C-2 / archive B4): TMDB's terms make the image itself
 * `non_commercial_only` with required attribution, never `commercial_allowed`
 * like the CC0/CC BY-SA catalog facts above it.
 *
 *   npm run build && node dist/scripts/load-catalog-rights.js [--dry-run]
 *
 * Input : src/scripts/fixtures/catalog.demo.json (session C's fixture, read
 *         only) -- per title: `externalIds.wikidata`, `descriptionSource`,
 *         `evidence.wikipedia { en, ar }`, `evidence.plotSource`.
 * Reads : titles, matched by internalId; a fixture entry with no loaded title
 *         is reported, not an error.
 * Writes: source_records only --
 *   - facts (titleEn, titleAr, releaseYear, genres, originalLanguage,
 *     externalIds): source 'wikidata', value 'wikidata:<QID>', CC0,
 *     commercial_allowed, attribution not required (credited anyway);
 *   - description: source 'wikipedia:en' (or 'wikidata' for the 7 titles
 *     whose lead is Wikidata's stub), value = the page URL, CC BY-SA 4.0,
 *     commercial_allowed with attribution required and share-alike noted;
 *   - enrichmentEvidence: the Wikipedia plot text sent to the LLM as input
 *     (FINGERPRINT_SCHEMA.md §5): same CC BY-SA row shape, allowsDerivation.
 *
 * One row per (title, field, source, extractor version); re-running skips
 * rows that exist. Nothing else is touched (BP §11.3: rows are appended,
 * never overwritten; corrections go through the admin board's supersede).
 */
import 'reflect-metadata';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';

export const EXTRACTOR_VERSION = 'load-catalog-rights-v1';

// The slice of the fixture this loader reads; the rest is session C's.
export interface CatalogRightsEntry {
  internalId: string;
  titleEn?: string | null;
  titleAr?: string | null;
  releaseYear?: number | null;
  genres?: string[] | null;
  originalLanguage?: string | null;
  externalIds?: { wikidata?: string; imdb?: string; tmdb?: string } | null;
  descriptionSource?: 'wikipedia:en' | 'wikidata' | null;
  description?: string | null;
  evidence?: { wikipedia?: { en?: string | null; ar?: string | null } | null; plotSource?: string | null } | null;
  /** TMDB's own relative path (`fetch-tmdb-posters.ts`), or `null` when TMDB has none; `undefined` when never fetched. */
  posterPath?: string | null;
}

export interface LoadCatalogRightsSummary {
  titlesMatched: number;
  titlesNotYetLoaded: string[];
  rowsCreated: number;
  rowsAlreadyLoaded: number;
  titlesWithoutWikidataId: string[];
}

export interface LoadCatalogRightsOptions {
  dryRun?: boolean;
  log?: (line: string) => void;
}

type RowSpec = Pick<
  SourceRecord,
  | 'fieldName'
  | 'value'
  | 'source'
  | 'license'
  | 'licenseStatus'
  | 'allowsStorage'
  | 'allowsDerivation'
  | 'allowsTraining'
  | 'attributionRequired'
  | 'fallbackPlan'
>;

const WIKIDATA_FACT_FIELDS = ['titleEn', 'titleAr', 'releaseYear', 'genres', 'originalLanguage', 'externalIds'] as const;

export function wikipediaUrl(lang: 'en' | 'ar', page: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`;
}

function wikidataRow(fieldName: string, qid: string): RowSpec {
  return {
    fieldName,
    value: `wikidata:${qid}`,
    source: 'wikidata',
    license: 'CC0 1.0',
    licenseStatus: 'commercial_allowed',
    allowsStorage: true,
    allowsDerivation: true,
    allowsTraining: true,
    attributionRequired: false,
    fallbackPlan: null,
  };
}

// TMDB's required attribution notice (their API terms), stored as this claim's
// license text since SourceRecord has no separate attribution-text column
// (the same pattern `license` already carries free-text terms in above).
const TMDB_ATTRIBUTION = 'TMDB Terms of Use: image non-commercial without a paid licence; attribution required — "This product uses the TMDB API but is not endorsed or certified by TMDB."';

function tmdbPosterRow(posterPath: string): RowSpec {
  return {
    fieldName: 'posterPath',
    value: `https://image.tmdb.org/t/p/original${posterPath}`,
    source: 'tmdb',
    license: TMDB_ATTRIBUTION,
    licenseStatus: 'non_commercial_only',
    allowsStorage: true,
    allowsDerivation: false,
    allowsTraining: false,
    attributionRequired: true,
    fallbackPlan: 'omit the poster (empty slot) until a licensed image is available',
  };
}

function wikipediaRow(fieldName: string, lang: 'en' | 'ar', page: string): RowSpec {
  return {
    fieldName,
    value: wikipediaUrl(lang, page),
    source: `wikipedia:${lang}`,
    license: 'CC BY-SA 4.0 (attribution and share-alike; verbatim text stays under the same license)',
    licenseStatus: 'commercial_allowed',
    allowsStorage: true,
    // Used as LLM input for abstract, non-textual features (FINGERPRINT_SCHEMA
    // §5); a verbatim or lightly edited copy of the text would itself be
    // CC BY-SA, which is why the fallback is our own synopsis.
    allowsDerivation: true,
    allowsTraining: true,
    attributionRequired: true,
    fallbackPlan: 'replace with an own-written synopsis (DATA_LICENSING.md §3.1, §3.6)',
  };
}

// Pure: which rows an entry earns. Absent values earn no row (never a
// fabricated claim, BP §11.3).
export function rowsFor(entry: CatalogRightsEntry): RowSpec[] {
  const rows: RowSpec[] = [];
  const qid = entry.externalIds?.wikidata;
  if (qid) {
    for (const field of WIKIDATA_FACT_FIELDS) {
      const value = entry[field];
      if (value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) {
        rows.push(wikidataRow(field, qid));
      }
    }
  }

  const enPage = entry.evidence?.wikipedia?.en ?? null;
  if (entry.description) {
    if (entry.descriptionSource === 'wikipedia:en' && enPage) {
      rows.push(wikipediaRow('description', 'en', enPage));
    } else if (entry.descriptionSource === 'wikidata' && qid) {
      rows.push(wikidataRow('description', qid));
    }
  }

  // 'wikipedia:en:<Page>' -- the plot text that went to the LLM.
  const plotSource = entry.evidence?.plotSource ?? null;
  const plot = plotSource?.match(/^wikipedia:(en|ar):(.+)$/);
  if (plot) {
    rows.push(wikipediaRow('enrichmentEvidence', plot[1] as 'en' | 'ar', plot[2]));
  }

  if (entry.externalIds?.tmdb && entry.posterPath) {
    rows.push(tmdbPosterRow(entry.posterPath));
  }
  return rows;
}

export async function loadCatalogRights(
  dataSource: DataSource,
  entries: CatalogRightsEntry[],
  options: LoadCatalogRightsOptions = {},
): Promise<LoadCatalogRightsSummary> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});
  const titlesRepository = dataSource.getRepository(Title);
  const sourceRecordsRepository = dataSource.getRepository(SourceRecord);
  const now = new Date();

  const summary: LoadCatalogRightsSummary = {
    titlesMatched: 0,
    titlesNotYetLoaded: [],
    rowsCreated: 0,
    rowsAlreadyLoaded: 0,
    titlesWithoutWikidataId: [],
  };

  for (const entry of entries) {
    const title = await titlesRepository.findOne({ where: { internalId: entry.internalId }, select: { id: true, internalId: true } });
    if (!title) {
      summary.titlesNotYetLoaded.push(entry.internalId);
      continue;
    }
    summary.titlesMatched += 1;
    if (!entry.externalIds?.wikidata) {
      summary.titlesWithoutWikidataId.push(entry.internalId);
    }

    const existing = await sourceRecordsRepository.find({
      where: { titleId: title.id, extractorVersion: EXTRACTOR_VERSION },
      select: { fieldName: true, source: true },
    });
    const have = new Set(existing.map((row) => `${row.fieldName}|${row.source}`));

    const rows = rowsFor(entry).filter((row) => !have.has(`${row.fieldName}|${row.source}`));
    summary.rowsAlreadyLoaded += existing.length;
    if (rows.length === 0) {
      continue;
    }
    log(`${entry.internalId}: ${rows.map((row) => `${row.fieldName}<-${row.source}`).join(', ')}`);
    summary.rowsCreated += rows.length;
    if (dryRun) {
      continue;
    }
    await sourceRecordsRepository.insert(
      rows.map((row) => ({
        ...row,
        titleId: title.id,
        extractorVersion: EXTRACTOR_VERSION,
        reviewStatus: 'unreviewed' as const,
        retrievedAt: now,
        validFrom: now,
      })),
    );
  }

  return summary;
}

function resolveFixturePath(): string {
  const packaged = path.resolve(__dirname, 'fixtures', 'catalog.demo.json');
  if (existsSync(packaged)) {
    return packaged;
  }
  return path.resolve(process.cwd(), 'src', 'scripts', 'fixtures', 'catalog.demo.json');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const entries = JSON.parse(await readFile(resolveFixturePath(), 'utf8')) as CatalogRightsEntry[];

  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  try {
    const summary = await loadCatalogRights(dataSource, entries, { dryRun, log: (line) => console.log(`  ${line}`) });
    console.log(
      `\n${dryRun ? '[dry run] would write' : 'Wrote'} ${summary.rowsCreated} rights row(s) across ${summary.titlesMatched} title(s) ` +
        `(${summary.rowsAlreadyLoaded} rows already loaded, skipped).`,
    );
    if (summary.titlesWithoutWikidataId.length > 0) {
      console.log(`${summary.titlesWithoutWikidataId.length} title(s) have no Wikidata id: ${summary.titlesWithoutWikidataId.join(', ')}`);
    }
    if (summary.titlesNotYetLoaded.length > 0) {
      console.log(
        `${summary.titlesNotYetLoaded.length} fixture title(s) have no row in titles yet, skipped: ` +
          summary.titlesNotYetLoaded.slice(0, 10).join(', ') +
          (summary.titlesNotYetLoaded.length > 10 ? ', ...' : ''),
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
