/**
 * Stage director credits from Wikidata for the demo catalog fixture (blueprint
 * gap 6): `people`/`credits`/`source_records` exist since M3 but nothing has
 * ever populated them, and `RecommendationsService.confidenceBand()`'s third
 * `§9.2` diversity axis (director) stays blocked until they are.
 *
 *   npx tsx src/scripts/fetch-director-credits.ts [--limit N] [--only DEMO0007]
 *
 * Input : src/scripts/fixtures/catalog.demo.json (read-only; session C's fixture --
 *         this script never writes there)
 * Output: src/scripts/director-credits/catalog.demo.directors.json
 *         src/scripts/director-credits/catalog.demo.directors.report.md
 *
 * Staged, not loaded: output is keyed by the fixture's own `internalId`, not a
 * database id -- no title has one yet (the catalog itself isn't loaded,
 * blueprint gap 1/WS3). Turning this into real `people`/`credits`/
 * `source_records` rows is a separate later step, once WS3 lands titles with
 * real ids to join against.
 *
 * Wikidata structured data is CC0 (DATA_LICENSING.md); P57 (director) only --
 * nothing else this codebase needs is fetched. Every remote answer is cached
 * on disk (DIRECTOR_CREDITS_CACHE_DIR), so re-runs are offline and fast, and
 * requests are rate-limited/backed off the same way fetch-catalog.ts's own
 * Wikidata calls are (an independent implementation -- this script has no
 * dependency on that file, session C's).
 *
 * This script has no dependency on the app: plain Node 20+ (global fetch), no
 * TypeORM.
 */
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { buildDirectorCredits, renderReport, summarize, type WikidataEntity } from './fetch-director-credits.lib';

const FIXTURES_DIR = existsSync(path.resolve(__dirname, 'fixtures'))
  ? path.resolve(__dirname, 'fixtures')
  : path.resolve(process.cwd(), 'src', 'scripts', 'fixtures');
const CATALOG_PATH = path.join(FIXTURES_DIR, 'catalog.demo.json');
const OUTPUT_DIR = existsSync(path.resolve(__dirname, 'fixtures'))
  ? path.resolve(__dirname, 'director-credits')
  : path.resolve(process.cwd(), 'src', 'scripts', 'director-credits');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'catalog.demo.directors.json');
const REPORT_PATH = path.join(OUTPUT_DIR, 'catalog.demo.directors.report.md');
const CACHE_DIR = process.env.DIRECTOR_CREDITS_CACHE_DIR ?? path.join(os.tmpdir(), 'movie-director-credits-cache');
const USER_AGENT = 'movie-taste-director-credits/0.1 (local development fixture builder; docs/ARCHITECTURE_DECISIONS.md ADR-64)';
const REQUEST_DELAY_MS = 250;
const WIKIDATA_BATCH = 50;

// ---------------------------------------------------------------------------
// HTTP with on-disk cache (same politeness constraints as fetch-catalog.ts's
// Wikidata calls -- caching, a distinguishing User-Agent, honoring
// Retry-After -- reimplemented independently rather than importing from a
// file that doesn't export it and that this script deliberately stays
// independent of).
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cachedGet(url: string): Promise<{ status: number; body: string }> {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash('sha1').update(url).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8')) as { status: number; body: string };
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await sleep(REQUEST_DELAY_MS);
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 3 ** attempt);
        continue;
      }
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const result = { status: response.status, body };
      await writeFile(cachePath, JSON.stringify(result), 'utf8');
      return result;
    } catch (error) {
      lastError = error;
      await sleep(1000 * 3 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`request failed: ${url}`);
}

async function getJson<T>(url: string): Promise<T> {
  const { body } = await cachedGet(url);
  return JSON.parse(body) as T;
}

interface WikidataResponse {
  entities?: Record<string, WikidataEntity>;
}

async function fetchEntities(ids: string[], props: string, languages: string): Promise<Record<string, WikidataEntity>> {
  const entities: Record<string, WikidataEntity> = {};
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += WIKIDATA_BATCH) {
    const batch = unique.slice(start, start + WIKIDATA_BATCH);
    const url =
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}` +
      `&props=${props}&languages=${languages}&format=json`;
    const result = await getJson<WikidataResponse>(url);
    Object.assign(entities, result.entities ?? {});
  }
  return entities;
}

// ---------------------------------------------------------------------------
// CLI args (same shape as fetch-catalog.ts: --limit N, --only ID)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { limit: number | null; only: string | null } {
  let limit: number | null = null;
  let only: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--only') {
      only = argv[index + 1];
      index += 1;
    }
  }
  return { limit, only };
}

interface CatalogFixtureEntry {
  internalId: string;
  externalIds?: { wikidata?: string };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8')) as CatalogFixtureEntry[];

  let selected = catalog.filter((entry) => entry.externalIds?.wikidata);
  if (args.only) {
    selected = selected.filter((entry) => entry.internalId === args.only);
  }
  if (args.limit) {
    selected = selected.slice(0, args.limit);
  }
  const skippedNoWikidataId = catalog.length - catalog.filter((entry) => entry.externalIds?.wikidata).length;

  const titles = selected.map((entry) => ({ internalId: entry.internalId, wikidataId: entry.externalIds!.wikidata! }));
  console.log(`Fetching P57 (director) claims for ${titles.length} title(s)...`);

  const failures: { internalId: string; detail: string }[] = [];
  const titleEntities: Record<string, WikidataEntity> = {};
  const succeeded: typeof titles = [];
  // One request per title's claims, not batched: a single bad id in a batch
  // would otherwise fail the whole batch and lose every other title's real
  // answer along with it (unlike fetch-catalog.ts's label/genre batch calls,
  // where every id in a run has already been validated by an earlier step).
  for (const title of titles) {
    try {
      const result = await fetchEntities([title.wikidataId], 'claims', 'en');
      Object.assign(titleEntities, result);
      succeeded.push(title);
    } catch (error) {
      failures.push({ internalId: title.internalId, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const directorQids = Object.values(titleEntities).flatMap((entity) => (entity.claims?.P57 ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { id: string } => typeof value === 'object' && value !== null && 'id' in value)
    .map((value) => value.id));
  console.log(`Resolving labels for ${new Set(directorQids).size} distinct director(s)...`);
  const personEntities = directorQids.length > 0 ? await fetchEntities(directorQids, 'labels', 'en|ar') : {};

  const credits = buildDirectorCredits(succeeded, titleEntities, personEntities);
  const stats = summarize(credits, failures);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(credits, null, 2) + '\n', 'utf8');
  await writeFile(REPORT_PATH, renderReport(stats, new Date()), 'utf8');

  console.log(
    `Wrote ${credits.length} title(s) (${stats.titlesWithAtLeastOneDirector} with a director, ` +
      `${stats.titlesWithNoDirectorClaim} with no P57 claim, ${failures.length} failed) to ${OUTPUT_PATH}`,
  );
  if (skippedNoWikidataId > 0) {
    console.log(`Skipped ${skippedNoWikidataId} catalog entr${skippedNoWikidataId === 1 ? 'y' : 'ies'} with no externalIds.wikidata.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
