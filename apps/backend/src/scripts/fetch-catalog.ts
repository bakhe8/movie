/**
 * Build the demo catalog fixture from Wikidata and Wikipedia.
 *
 *   npx tsx src/scripts/fetch-catalog.ts [--limit N] [--only DEMO0007] [--no-plot]
 *
 * Input : src/scripts/fixtures/catalog.demo.list.tsv  (explicit, permanently reserved internalIds)
 * Output: src/scripts/fixtures/catalog.demo.json      (the fixture db:seed:demo reads; committed)
 *         src/scripts/fixtures/catalog.demo.report.md (balance report + every warning; committed)
 *
 * Resolution: each row names a Wikipedia page (lang:Title); the page summary gives the Wikidata
 * item, which gives labels (en/ar), year, genres, original language, country, IMDb/TMDB ids
 * and sitelinks. Wikipedia then supplies a short spoiler-free description (lead, first two
 * sentences, en + ar) and the plot section as enrichment evidence (fixture-only, never persisted).
 *
 * Rules (docs/DEMO_DATA_PLAN_2026-09-03.md WS1, DATA_LICENSING.md §4):
 *  - never invent: an Arabic title comes from a Wikidata label, an arwiki page title, or the
 *    row's manual override -- otherwise the row is reported and excluded, never transliterated;
 *  - the fixture is a development artefact with licenseStatus 'unknown' throughout; it is not
 *    a rights registry and must not appear in any external test or production database;
 *  - every remote answer is cached on disk (CATALOG_CACHE_DIR), so re-runs are offline and fast.
 *
 * This script has no dependency on the app: plain Node 20+ (global fetch), no TypeORM.
 */
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { assertCumulativeIdentities, assertReservedIdentities, assertSourceReservations, mergeCatalog, SourceReservation } from './catalog-identity';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FIXTURES_DIR = existsSync(path.resolve(__dirname, 'fixtures'))
  ? path.resolve(__dirname, 'fixtures')
  : path.resolve(process.cwd(), 'src', 'scripts', 'fixtures');
const LIST_PATH = path.join(FIXTURES_DIR, 'catalog.demo.list.tsv');
const OUTPUT_PATH = path.join(FIXTURES_DIR, 'catalog.demo.json');
const REPORT_PATH = path.join(FIXTURES_DIR, 'catalog.demo.report.md');
const IDENTITY_PATH = path.join(FIXTURES_DIR, 'catalog.demo.identity.json');
const CACHE_DIR = process.env.CATALOG_CACHE_DIR ?? path.join(os.tmpdir(), 'movie-catalog-cache');
// Wikimedia asks for an identifying agent; no personal data in it.
const USER_AGENT = 'movie-taste-demo-catalog/0.1 (local development fixture builder; docs/DEMO_DATA_PLAN_2026-09-03.md)';
const REQUEST_DELAY_MS = 250;
const WIKIDATA_BATCH = 50;
const PLOT_MAX_CHARS = 3000;
const DESCRIPTION_MAX_CHARS = 400;

// Wikidata properties / classes used below.
const P = {
  instanceOf: 'P31',
  publicationDate: 'P577',
  genre: 'P136',
  originalLanguage: 'P364',
  country: 'P495',
  imdb: 'P345',
  tmdb: 'P4947',
  iso639_1: 'P218',
  iso639_3: 'P220',
  iso3166_alpha2: 'P297',
} as const;
const FILM_CLASSES = new Set([
  'Q11424', // film
  'Q24862', // short film
  'Q202866', // animated film
  'Q506240', // television film
  'Q229390', // 3D film
  'Q20667187', // silent film
  'Q93204', // documentary film
  'Q226730', // silent feature film
  'Q24869', // feature film
  'Q31235', // anime film (in case of animated works)
  'Q20650540', // anime film (the class Wikidata actually uses)
  'Q29168811', // animated feature film
  'Q17517379', // film (some items use this subclass)
]);
const ANIMATION_CLASSES = new Set(['Q202866', 'Q20650540', 'Q29168811', 'Q31235', 'Q63952888' /* computer-animated film */]);

// Wikidata genre label (English, lower-case) -> the app's genre vocabulary.
// Meta-genres that describe production rather than content map to [] and are dropped.
const GENRE_MAP: Record<string, string[]> = {
  'drama film': ['Drama'],
  drama: ['Drama'],
  melodrama: ['Drama'],
  'social drama': ['Drama'],
  'social problem film': ['Drama'],
  'psychological drama': ['Drama'],
  'legal drama': ['Drama'],
  'comedy film': ['Comedy'],
  comedy: ['Comedy'],
  'comedy-drama': ['Comedy', 'Drama'],
  'black comedy': ['Comedy'],
  'dark comedy': ['Comedy'],
  'satirical film': ['Comedy'],
  satire: ['Comedy'],
  'slapstick film': ['Comedy'],
  'buddy film': ['Comedy'],
  'romantic comedy': ['Romance', 'Comedy'],
  'romance film': ['Romance'],
  'romantic drama': ['Romance', 'Drama'],
  'thriller film': ['Thriller'],
  thriller: ['Thriller'],
  'psychological thriller': ['Thriller'],
  'psychological thriller film': ['Thriller'],
  'political thriller': ['Thriller'],
  'techno-thriller': ['Thriller'],
  'crime film': ['Crime'],
  'crime thriller': ['Crime', 'Thriller'],
  'crime thriller film': ['Crime', 'Thriller'],
  'crime drama': ['Crime', 'Drama'],
  'crime drama film': ['Crime', 'Drama'],
  'crime comedy': ['Crime', 'Comedy'],
  'heist film': ['Crime'],
  'gangster film': ['Crime'],
  'action film': ['Action'],
  'action thriller': ['Action', 'Thriller'],
  'action thriller film': ['Action', 'Thriller'],
  'action comedy film': ['Action', 'Comedy'],
  'martial arts film': ['Action'],
  'wuxia film': ['Action', 'Fantasy'],
  'adventure film': ['Adventure'],
  'science fiction film': ['Science Fiction'],
  'science fiction action film': ['Science Fiction', 'Action'],
  'space opera': ['Science Fiction'],
  'dystopian film': ['Science Fiction'],
  'fantasy film': ['Fantasy'],
  'dark fantasy': ['Fantasy'],
  'horror film': ['Horror'],
  'psychological horror': ['Horror'],
  'psychological horror film': ['Horror'],
  'slasher film': ['Horror'],
  'zombie film': ['Horror'],
  'folk horror': ['Horror'],
  'monster film': ['Horror'],
  'animated film': ['Animation'],
  'animated feature film': ['Animation'],
  'anime film': ['Animation'],
  'computer-animated film': ['Animation'],
  'musical film': ['Musical'],
  musical: ['Musical'],
  'music film': ['Music'],
  'war film': ['War'],
  'anti-war film': ['War'],
  western: ['Western'],
  'western film': ['Western'],
  'documentary film': ['Documentary'],
  'docudrama': ['Documentary', 'Drama'],
  'biographical film': ['Biography'],
  'autobiographical film': ['Biography', 'Drama'],
  biopic: ['Biography'],
  'historical film': ['History'],
  'historical drama': ['History', 'Drama'],
  'historical drama film': ['History', 'Drama'],
  'period drama': ['History', 'Drama'],
  'costume drama': ['History', 'Drama'],
  'mystery film': ['Mystery'],
  mystery: ['Mystery'],
  'family film': ['Family'],
  "children's film": ['Family'],
  'film noir': ['Film Noir'],
  'neo-noir': ['Film Noir'],
  'coming-of-age story': ['Coming-of-Age'],
  'coming-of-age film': ['Coming-of-Age'],
  'teen film': ['Coming-of-Age'],
  'sports film': ['Sport'],
  'disaster film': ['Disaster'],
  'spy film': ['Spy'],
  'superhero film': ['Superhero'],
  'epic film': ['Epic'],
  'road movie': ['Road Movie'],
  'political film': ['Political'],
  'political drama': ['Political', 'Drama'],
  'erotic film': ['Romance'],
  'erotic thriller': ['Thriller'],
  'religious film': ['Drama'],
  'survival film': ['Adventure'],
  'apocalyptic film': ['Science Fiction'],
  'post-apocalyptic film': ['Science Fiction'],
  'body horror': ['Horror'],
  'vampire film': ['Horror'],
  'ghost film': ['Horror'],
  'tragedy': ['Drama'],
  // Meta-genres: dropped.
  'art film': [],
  'independent film': [],
  'feature film': [],
  'lgbt-related film': [],
  'lgbtq-related film': [],
  'silent film': [],
  'film based on a novel': [],
  'film based on literature': [],
  'film adaptation': [],
  'film based on a true story': [],
  'film based on actual events': [],
  '3d film': [],
  'cult film': [],
  'black-and-white film': [],
  'experimental film': [],
  'debut film': [],
  'remake': [],
  'sequel': [],
  'film sequel': [],
  'prequel': [],
  'ensemble film': [],
  'arthouse film': [],
  'short film': [],
  'live-action film': [],
  'film in the public domain': [],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Slice = 'ar' | 'en' | 'other';
type Tier = 'popular' | 'mid' | 'niche';

interface ListRow {
  line: number;
  internalId: string;
  slice: Slice;
  region: string;
  tier: Tier;
  year: number;
  titleEn: string;
  wikiLang: string;
  wikiTitle: string;
  titleArOverride: string | null;
  genresOverride: string[] | null;
}

interface WikiSummary {
  type?: string;
  title?: string;
  wikibase_item?: string;
  extract?: string;
  description?: string;
}

interface WikiSearchResponse {
  query?: { search?: { title: string }[] };
}

interface WikiExtractResponse {
  query?: { pages?: { title?: string; extract?: string; missing?: boolean }[] };
}

interface WdSnak {
  mainsnak?: { datavalue?: { value?: unknown } };
}
interface WdEntity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, WdSnak[]>;
  sitelinks?: Record<string, { title: string }>;
}
interface WdResponse {
  entities?: Record<string, WdEntity>;
}

export interface CatalogEntry {
  internalId: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  descriptionSource: 'wikipedia:en' | 'wikidata' | null;
  descriptionAr: string | null;
  releaseYear: number | null;
  genres: string[];
  externalIds: { wikidata: string; imdb?: string; tmdb?: string };
  // Fixture-only fields (not columns of `titles`): balance reporting and enrichment evidence.
  originalLanguage: string | null;
  languages: string[];
  country: string | null;
  countries: string[];
  slice: Slice;
  region: string;
  tier: Tier;
  evidence: {
    plotSummary: string | null;
    plotSource: string | null;
    sourceIds: string[];
    wikipedia: { en?: string; ar?: string };
    wikidataLabelEn?: string;
    titleArSource?: string;
  };
  fingerprint: null;
}

interface Warning {
  internalId: string;
  titleEn: string;
  kind: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// HTTP with on-disk cache
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
        // Honour Retry-After when Wikimedia sends one; otherwise back off hard
        // (5 s, 15 s, 45 s) -- a 429 window there is longer than a few seconds.
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 3 ** attempt);
        continue;
      }
      const result = { status: response.status, body };
      // 200 and 404 are both stable answers worth caching; anything else is not.
      if (response.status === 200 || response.status === 404) {
        await writeFile(cachePath, JSON.stringify(result), 'utf8');
      }
      return result;
    } catch (error) {
      lastError = error;
      await sleep(1000 * 3 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`request failed: ${url}`);
}

async function getJson<T>(url: string): Promise<T | null> {
  const { status, body } = await cachedGet(url);
  if (status === 404) {
    return null;
  }
  if (status !== 200) {
    throw new Error(`HTTP ${status} for ${url}`);
  }
  return JSON.parse(body) as T;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

async function readList(): Promise<ListRow[]> {
  const text = await readFile(LIST_PATH, 'utf8');
  const rows: ListRow[] = [];
  let headerSeen = false;
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }
    if (!headerSeen) {
      headerSeen = true; // the column header
      return;
    }
    const cells = rawLine.split('\t').map((cell) => cell.trim());
    const [slice, region, tier, year, titleEn, wiki, titleArOverride, genresOverride, internalId] = cells;
    if (!/^DEMO\d{4}$/.test(internalId ?? '')) throw new Error(`line ${index + 1}: explicit internalId required`);
    if (!slice || !region || !tier || !year || !titleEn || !wiki) {
      throw new Error(`catalog.demo.list.tsv line ${index + 1}: expected 6+ tab-separated cells, got ${cells.length}`);
    }
    if (!['ar', 'en', 'other'].includes(slice) || !['popular', 'mid', 'niche'].includes(tier)) {
      throw new Error(`catalog.demo.list.tsv line ${index + 1}: bad slice/tier "${slice}/${tier}"`);
    }
    const separator = wiki.indexOf(':');
    if (separator < 1) {
      throw new Error(`catalog.demo.list.tsv line ${index + 1}: wiki must look like en:Page_Title`);
    }
    rows.push({
      line: index + 1,
      internalId,
      slice: slice as Slice,
      region,
      tier: tier as Tier,
      year: Number(year),
      titleEn,
      wikiLang: wiki.slice(0, separator),
      wikiTitle: wiki.slice(separator + 1),
      titleArOverride: titleArOverride ? titleArOverride : null,
      genresOverride: genresOverride ? genresOverride.split(',').map((genre) => genre.trim()).filter(Boolean) : null,
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Wikipedia
// ---------------------------------------------------------------------------

interface WikiPagePropsResponse {
  query?: {
    pages?: { title?: string; extract?: string; missing?: boolean; pageprops?: { wikibase_item?: string; disambiguation?: string } }[];
  };
}

// The action API (not the REST summary endpoint): one call returns the lead
// paragraph, the Wikidata item and the disambiguation flag, follows redirects,
// and is the endpoint Wikimedia rate-limits most leniently for scripts.
async function fetchSummary(lang: string, title: string): Promise<WikiSummary | null> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|pageprops&exintro=1&explaintext=1` +
    `&ppprop=wikibase_item|disambiguation&redirects=1&titles=${encodeURIComponent(title.replace(/ /g, '_'))}&format=json&formatversion=2`;
  const result = await getJson<WikiPagePropsResponse>(url);
  const page = result?.query?.pages?.[0];
  if (!page || page.missing || page.pageprops?.disambiguation !== undefined || !page.pageprops?.wikibase_item) {
    return null;
  }
  return { type: 'standard', title: page.title, wikibase_item: page.pageprops.wikibase_item, extract: page.extract };
}

async function searchWikipedia(lang: string, query: string): Promise<string[]> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&formatversion=2`;
  const result = await getJson<WikiSearchResponse>(url);
  return result?.query?.search?.map((hit) => hit.title) ?? [];
}

async function fetchExtract(lang: string, title: string): Promise<string | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
  const result = await getJson<WikiExtractResponse>(url);
  const page = result?.query?.pages?.[0];
  if (!page || page.missing || !page.extract) {
    return null;
  }
  return page.extract;
}

const PLOT_HEADINGS: Record<string, string[]> = {
  en: ['Plot', 'Plot summary', 'Synopsis', 'Premise', 'Story', 'Storyline', 'Summary'],
  ar: ['القصة', 'قصة الفيلم', 'الحبكة', 'ملخص القصة', 'الملخص', 'أحداث الفيلم', 'القصة والأحداث', 'ملخص', 'الأحداث'],
};

function extractSection(extract: string, headings: string[]): string | null {
  const lines = extract.split('\n');
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  let collecting = false;
  const buffer: string[] = [];
  for (const line of lines) {
    const heading = /^==\s*([^=].*?)\s*==$/.exec(line.trim());
    if (heading) {
      if (collecting) {
        break;
      }
      collecting = wanted.has(heading[1].toLowerCase());
      continue;
    }
    if (collecting) {
      // Sub-section headings (=== ... ===) stay inline as plain text.
      buffer.push(line.replace(/^=+\s*|\s*=+$/g, ''));
    }
  }
  const text = buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 0 ? text : null;
}

function capAtSentence(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('؟ '), cut.lastIndexOf('! '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
}

function firstSentences(text: string | undefined, count: number): string | null {
  if (!text) {
    return null;
  }
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const sentences = cleaned.split(/(?<=[.!?؟])\s+(?=[^a-z])/u).filter(Boolean);
  const picked = sentences.slice(0, count).join(' ');
  return picked ? capAtSentence(picked, DESCRIPTION_MAX_CHARS) : null;
}

// ---------------------------------------------------------------------------
// Wikidata
// ---------------------------------------------------------------------------

async function fetchEntities(ids: string[], props: string, languages: string, sitefilter?: string): Promise<Record<string, WdEntity>> {
  const entities: Record<string, WdEntity> = {};
  for (let start = 0; start < ids.length; start += WIKIDATA_BATCH) {
    const batch = ids.slice(start, start + WIKIDATA_BATCH);
    const url =
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}` +
      `&props=${props}&languages=${languages}${sitefilter ? `&sitefilter=${sitefilter}` : ''}&format=json`;
    const result = await getJson<WdResponse>(url);
    Object.assign(entities, result?.entities ?? {});
  }
  return entities;
}

function claimIds(entity: WdEntity, property: string): string[] {
  return (entity.claims?.[property] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { id: string } => typeof value === 'object' && value !== null && 'id' in value)
    .map((value) => value.id);
}

function claimStrings(entity: WdEntity, property: string): string[] {
  return (entity.claims?.[property] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is string => typeof value === 'string');
}

function earliestYear(entity: WdEntity): number | null {
  const years = (entity.claims?.[P.publicationDate] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { time: string } => typeof value === 'object' && value !== null && 'time' in value)
    .map((value) => Number(/^[+-]?(\d{4})/.exec(value.time)?.[1]))
    .filter((year) => Number.isFinite(year) && year > 1880);
  return years.length > 0 ? Math.min(...years) : null;
}

function stripArabicDisambiguation(title: string): string {
  return title.replace(/\s*\((?:فيلم|فلم)[^)]*\)\s*$/u, '').trim();
}

// Keyword fallback for the long tail of Wikidata sub-genres ("suspense film",
// "arthouse science fiction film", "girls with guns"): each pattern folds the
// label into one or two vocabulary genres. A label matching nothing here is a
// production tag, not a genre, and is dropped (and listed in the report).
const GENRE_KEYWORDS: [RegExp, string[]][] = [
  [/tragicomedy|comedy[- ]drama|dramedy/i, ['Comedy', 'Drama']],
  [/romantic|romance|chick flick/i, ['Romance']],
  [/comedy|comedic|satir|parody|slapstick|farce|screwball/i, ['Comedy']],
  [/film noir|neo-noir|tech noir/i, ['Film Noir']],
  [/thriller|suspense/i, ['Thriller']],
  [/horror|slasher|zombie/i, ['Horror']],
  [/science fiction|sci-fi|cyberpunk|space|dystopia|time[- ]travel|alternate history|speculative/i, ['Science Fiction']],
  [/fantasy|fairy tale|magic|sword and sorcery|supernatural|wuxia/i, ['Fantasy']],
  [/western/i, ['Western']],
  [/\bwar\b|military|submarine|anti-war/i, ['War']],
  [/crime|gangster|heist|police|detective|prison|vigilante|hood film|caper/i, ['Crime']],
  [/action|martial arts|swashbuckler|chase film|girls with guns|samurai|kung fu/i, ['Action']],
  [/adventure|treasure|pirate|survival|road movie/i, ['Adventure']],
  [/musical|dance/i, ['Musical']],
  [/anime|animated|animation/i, ['Animation']],
  [/documentary|docufiction|docudrama/i, ['Documentary']],
  [/mystery|whodunit/i, ['Mystery']],
  [/sport|football|boxing|baseball|racing/i, ['Sport']],
  [/political/i, ['Political']],
  [/biograph|biopic|autobiograph/i, ['Biography']],
  [/epic/i, ['Epic']],
  [/historical|period|medieval|sword-and-sandal|costume/i, ['History']],
  [/coming[- ]of[- ]age|teen/i, ['Coming-of-Age']],
  [/family|children/i, ['Family']],
  [/disaster|apocalyptic/i, ['Disaster']],
  [/superhero/i, ['Superhero']],
  [/\bspy\b|espionage/i, ['Spy']],
  [/melodrama|drama|tragedy/i, ['Drama']],
];
const MAX_GENRES = 4;

function mapGenres(labels: string[]): { genres: string[]; unknown: string[]; dropped: string[] } {
  const genres: string[] = [];
  const unknown: string[] = [];
  const dropped: string[] = [];
  for (const label of labels) {
    const key = label.toLowerCase();
    const mapped = GENRE_MAP[key];
    if (mapped) {
      genres.push(...mapped);
      continue;
    }
    const byKeyword = GENRE_KEYWORDS.find(([pattern]) => pattern.test(label));
    if (byKeyword) {
      unknown.push(label);
      genres.push(...byKeyword[1]);
    } else {
      dropped.push(label);
    }
  }
  // Wikidata lists the main genre first often enough that keeping claim order
  // and capping is better than any re-ranking we could invent.
  return { genres: [...new Set(genres)].slice(0, MAX_GENRES), unknown, dropped };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { limit: number | null; only: string | null; plot: boolean } {
  let limit: number | null = null;
  let only: string | null = null;
  let plot = true;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--only') {
      only = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--no-plot') {
      plot = false;
    }
  }
  return { limit, only, plot };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let rows = await readList();
  const reserved = JSON.parse(await readFile(IDENTITY_PATH, 'utf8')) as SourceReservation[];
  assertSourceReservations(reserved, rows.map((row) => ({ ...row, wiki: `${row.wikiLang}:${row.wikiTitle}` })));
  const reservationById = new Map(reserved.map((row) => [row.internalId, row]));
  const previous = JSON.parse(await readFile(OUTPUT_PATH, 'utf8')) as CatalogEntry[];
  assertCumulativeIdentities(previous, reserved, true);
  for (const row of rows.filter((row) => row.titleArOverride && !previous.some((old) => old.internalId === row.internalId))) {
    const reservation = reservationById.get(row.internalId)!;
    const proof = reservation.titleArEvidence;
    if (!proof || proof.title !== row.titleArOverride || !proof.url.startsWith('https://') ||
        proof.imdb !== reservation.externalIds?.imdb || proof.wikidata !== reservation.externalIds?.wikidata) {
      throw new Error(`unverified Arabic override: ${row.internalId}`);
    }
  }
  if (args.only) {
    rows = rows.filter((row) => row.internalId === args.only);
  }
  if (args.limit) {
    rows = rows.slice(0, args.limit);
  }
  console.log(`catalog: ${rows.length} rows from ${path.relative(process.cwd(), LIST_PATH)}; cache ${CACHE_DIR}`);

  const warnings: Warning[] = [];
  const warn = (row: ListRow, kind: string, detail: string) => {
    warnings.push({ internalId: row.internalId, titleEn: row.titleEn, kind, detail });
    console.log(`  ! ${row.internalId} ${row.titleEn}: ${kind} — ${detail}`);
  };

  // 1. Resolve each row to a Wikidata item through its Wikipedia page.
  const resolved = new Map<string, { qid: string; summary: WikiSummary; lang: string; title: string; guessed: boolean }>();
  for (const row of rows) {
    let summary = await fetchSummary(row.wikiLang, row.wikiTitle);
    let title = row.wikiTitle.replace(/_/g, ' ');
    let guessed = false;
    if (!summary) {
      const hits = await searchWikipedia(row.wikiLang, `${row.titleEn} ${row.year} film`);
      // Only a hit that actually contains the working title counts; anything
      // looser ("List of films: I") is worse than an honest "unresolved".
      const needle = row.titleEn.toLowerCase();
      const candidate = hits.find((hit) => hit.toLowerCase().includes(needle)) ?? null;
      if (candidate) {
        summary = await fetchSummary(row.wikiLang, candidate);
        title = candidate;
        guessed = true;
      }
    }
    if (!summary?.wikibase_item) {
      warn(row, 'unresolved', `no Wikipedia page found for ${row.wikiLang}:${row.wikiTitle} (fix the wiki column)`);
      continue;
    }
    if (guessed) {
      warn(row, 'guessed-page', `${row.wikiLang}:${row.wikiTitle} not found; used search hit "${title}" → ${summary.wikibase_item}. Verify, then pin it in the list`);
      continue; // A search suggestion is a blocker, never authority to bind a work.
    }
    if (summary.wikibase_item !== reservationById.get(row.internalId)?.externalIds?.wikidata) {
      throw new Error(`resolved Wikidata rebind: ${row.internalId} -> ${summary.wikibase_item}`);
    }
    resolved.set(row.internalId, { qid: summary.wikibase_item, summary, lang: row.wikiLang, title: summary.title ?? title, guessed });
    process.stdout.write(`  ${row.internalId} ${row.titleEn} → ${summary.wikibase_item}\n`);
  }

  // 2. Wikidata facts for every resolved item, then the referenced genre/language/country items.
  const qids = [...new Set([...resolved.values()].map((entry) => entry.qid))];
  const entities = await fetchEntities(qids, 'labels|descriptions|claims|sitelinks', 'en|ar', 'enwiki|arwiki');
  const referenced = new Set<string>();
  for (const entity of Object.values(entities)) {
    [P.genre, P.originalLanguage, P.country].forEach((property) => claimIds(entity, property).forEach((id) => referenced.add(id)));
  }
  const referencedEntities = await fetchEntities([...referenced], 'labels|claims', 'en');
  const labelOf = (id: string): string => referencedEntities[id]?.labels?.en?.value ?? id;
  const codeOf = (id: string, property: string): string | null => claimStrings(referencedEntities[id] ?? { id }, property)[0]?.toLowerCase() ?? null;
  // Wikidata files most films under a variety ("Egyptian Arabic", "Classical
  // Arabic", "Levantine Arabic"...) that has an ISO 639-3 code but no 639-1
  // code. The catalog speaks ISO 639-1, so every Arabic variety is 'ar'; other
  // languages fall back to their 639-3 code, then to the English label.
  const languageCodeOf = (id: string): string => {
    const label = labelOf(id);
    if (/\barabic\b/i.test(label)) {
      return 'ar';
    }
    if (/\benglish\b/i.test(label)) {
      return 'en'; // "American English", "British English"
    }
    return codeOf(id, P.iso639_1) ?? codeOf(id, P.iso639_3) ?? label;
  };

  // 3. Assemble entries.
  const entries: CatalogEntry[] = [];
  const unknownGenres = new Map<string, number>();
  const droppedGenres = new Map<string, number>();
  for (const row of rows) {
    const hit = resolved.get(row.internalId);
    if (!hit) {
      continue;
    }
    const entity = entities[hit.qid];
    if (!entity || entity.missing !== undefined) {
      warn(row, 'wikidata-missing', `entity ${hit.qid} not returned`);
      continue;
    }

    const classes = claimIds(entity, P.instanceOf);
    if (!classes.some((id) => FILM_CLASSES.has(id))) {
      warn(row, 'not-a-film-class', `P31 = ${classes.join(', ') || 'none'} — check the page points at the film, not a book/series`);
    }

    const year = earliestYear(entity);
    if (year === null) {
      warn(row, 'no-year', 'no P577 publication date; keeping the list year');
    } else if (Math.abs(year - row.year) > 1) {
      warn(row, 'year-mismatch', `list says ${row.year}, Wikidata says ${year} — check the page`);
    }

    const enSitelink = entity.sitelinks?.enwiki?.title;
    const arSitelink = entity.sitelinks?.arwiki?.title;
    // The English title is the curated one: Wikidata's English label for an
    // Arabic film is often a bare transliteration ("Ahlam Hind we Camilia")
    // where a real release title exists. The label is kept as evidence.
    const titleEn = row.titleEn;
    const wikidataLabelEn = entity.labels?.en?.value ?? null;
    const titleAr = row.titleArOverride ?? entity.labels?.ar?.value ?? (arSitelink ? stripArabicDisambiguation(arSitelink) : null);
    if (!titleAr) {
      warn(row, 'no-arabic-title', 'no Arabic label, no arwiki page, no override — excluded (add titleAr in the list or fix Wikidata)');
      continue;
    }

    const languageIds = claimIds(entity, P.originalLanguage);
    const languages = [...new Set(languageIds.map(languageCodeOf))];
    const countryIds = claimIds(entity, P.country);
    const countries = countryIds.map((id) => codeOf(id, P.iso3166_alpha2)?.toUpperCase() ?? labelOf(id));
    const expectedLanguage = row.slice === 'ar' ? 'ar' : row.slice === 'en' ? 'en' : null;
    if (expectedLanguage && languages.length > 0 && !languages.includes(expectedLanguage)) {
      warn(row, 'language-mismatch', `slice ${row.slice} but P364 = ${languages.join(', ')}`);
    }
    if (languages.length === 0) {
      warn(row, 'no-language', 'no P364 original language on Wikidata');
    }

    // Animation is a class (P31 "animated film", "anime film"...) on Wikidata far
    // more often than a genre (P136), so it is read from the class list first.
    const isAnimated = classes.some((id) => ANIMATION_CLASSES.has(id));
    const mapped = mapGenres(claimIds(entity, P.genre).map(labelOf));
    mapped.unknown.forEach((label) => unknownGenres.set(label, (unknownGenres.get(label) ?? 0) + 1));
    mapped.dropped.forEach((label) => droppedGenres.set(label, (droppedGenres.get(label) ?? 0) + 1));
    // A manual override fills a Wikidata gap; it never silently replaces real data.
    const fromWikidata = [...(isAnimated ? ['Animation'] : []), ...mapped.genres.filter((genre) => genre !== 'Animation')].slice(0, MAX_GENRES);
    const genres = fromWikidata.length > 0 ? fromWikidata : (row.genresOverride ?? []);
    if (genres.length === 0) {
      warn(row, 'no-genre', 'no P136 genre on Wikidata (add a genres override in the list)');
    }

    const imdb = claimStrings(entity, P.imdb)[0];
    const tmdb = claimStrings(entity, P.tmdb)[0];
    if (!imdb) {
      warn(row, 'no-imdb', 'no P345');
    }

    // Descriptions: Wikipedia lead (first two sentences), en then ar; Wikidata description as the last resort.
    const enSummary = hit.lang === 'en' ? hit.summary : enSitelink ? await fetchSummary('en', enSitelink) : null;
    const arSummary = hit.lang === 'ar' ? hit.summary : arSitelink ? await fetchSummary('ar', arSitelink) : null;
    const enLead = firstSentences(enSummary?.extract, 2);
    const description = enLead ?? entity.descriptions?.en?.value ?? null;
    // Wikidata's English description is a stub ("1955 film"); the Arabic lead is
    // the real description for those films, so the seed can prefer descriptionAr.
    const descriptionSource: CatalogEntry['descriptionSource'] = enLead ? 'wikipedia:en' : description ? 'wikidata' : null;
    const descriptionAr = firstSentences(arSummary?.extract, 2) ?? entity.descriptions?.ar?.value ?? null;
    if (!description) {
      warn(row, 'no-description', 'no English lead or Wikidata description');
    } else if (descriptionSource === 'wikidata') {
      warn(row, 'description-from-wikidata', `English description is Wikidata's stub "${description}"; descriptionAr carries the real one`);
    }

    // Plot as enrichment evidence: en plot section, else ar plot section, else the lead.
    let plotSummary: string | null = null;
    let plotSource: string | null = null;
    const sourceIds = [`wikidata:${hit.qid}`];
    if (args.plot) {
      if (enSitelink) {
        const extract = await fetchExtract('en', enSitelink);
        const section = extract ? extractSection(extract, PLOT_HEADINGS.en) : null;
        if (section) {
          plotSummary = capAtSentence(section, PLOT_MAX_CHARS);
          plotSource = `wikipedia:en:${enSitelink}`;
        }
      }
      if (!plotSummary && arSitelink) {
        const extract = await fetchExtract('ar', arSitelink);
        const section = extract ? extractSection(extract, PLOT_HEADINGS.ar) : null;
        if (section) {
          plotSummary = capAtSentence(section, PLOT_MAX_CHARS);
          plotSource = `wikipedia:ar:${arSitelink}`;
        }
      }
      if (!plotSummary) {
        const lead = enSummary?.extract ?? arSummary?.extract ?? null;
        if (lead) {
          plotSummary = capAtSentence(lead, PLOT_MAX_CHARS);
          plotSource = enSummary?.extract ? `wikipedia:en:${enSitelink ?? hit.title}:lead` : `wikipedia:ar:${arSitelink ?? hit.title}:lead`;
          warn(row, 'plot-from-lead', 'no Plot section found; the article lead is the only evidence');
        } else {
          warn(row, 'no-plot', 'no plot text anywhere — enrichment will have only the title and description');
        }
      }
      if (plotSource) {
        sourceIds.push(plotSource);
      }
    }

    entries.push({
      internalId: row.internalId,
      titleEn,
      titleAr,
      description,
      descriptionSource,
      descriptionAr,
      releaseYear: year ?? row.year,
      genres,
      externalIds: { wikidata: hit.qid, ...(imdb ? { imdb } : {}), ...(tmdb ? { tmdb } : {}) },
      originalLanguage: languages[0] ?? null,
      languages,
      country: countries[0] ?? null,
      countries,
      slice: row.slice,
      region: row.region,
      tier: row.tier,
      evidence: {
        plotSummary,
        plotSource,
        sourceIds,
        wikipedia: { ...(enSitelink ? { en: enSitelink } : {}), ...(arSitelink ? { ar: arSitelink } : {}) },
        ...(wikidataLabelEn && wikidataLabelEn !== titleEn ? { wikidataLabelEn } : {}),
        ...(row.titleArOverride && reservationById.get(row.internalId)?.titleArEvidence
          ? { titleArSource: reservationById.get(row.internalId)!.titleArEvidence!.url } : {}),
      },
      fingerprint: null,
    });
  }

  // Check against every reserved/admitted work, including ones outside a partial run.
  assertReservedIdentities(reserved, entries);
  const merged = mergeCatalog(previous, entries);

  // 5. Write the fixture (only when running the full list, so a --limit/--only probe never truncates it).
  const partial = args.only !== null || args.limit !== null;
  const blocking = warnings.filter((warning) => ['unresolved', 'no-arabic-title', 'wikidata-missing', 'guessed-page', 'year-mismatch', 'not-a-film-class'].includes(warning.kind));
  // Missing Arabic labels stay excluded; other verified additions may accumulate.
  // Identity conflicts throw above, before either output is written.
  const mayWrite = !partial && blocking.every((warning) => warning.kind === 'no-arabic-title');
  if (mayWrite) {
    await writeFile(OUTPUT_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  }
  await writeFile(REPORT_PATH, buildReport(rows, entries, warnings, unknownGenres, droppedGenres, partial), 'utf8');
  console.log(`\n${entries.length}/${rows.length} resolved entries; ${merged.length} cumulative entries${mayWrite ? ` → ${path.relative(process.cwd(), OUTPUT_PATH)}` : ' (fixture not written)'}`);
  console.log(`${warnings.length} warnings → ${path.relative(process.cwd(), REPORT_PATH)}`);
  if (blocking.length > 0) {
    console.log(`${blocking.length} blocking warning(s): the list needs fixing before the fixture is complete`);
    process.exitCode = 1;
  }
}

function count<T>(items: T[], key: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  items.forEach((item) => map.set(key(item), (map.get(key(item)) ?? 0) + 1));
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function table(rows: [string, number][], header: [string, string], total: number): string {
  const lines = [`| ${header[0]} | ${header[1]} | % |`, '|---|---|---|'];
  rows.forEach(([key, value]) => lines.push(`| ${key} | ${value} | ${total ? Math.round((100 * value) / total) : 0} |`));
  return lines.join('\n');
}

function buildReport(
  rows: ListRow[],
  entries: CatalogEntry[],
  warnings: Warning[],
  unknownGenres: Map<string, number>,
  droppedGenres: Map<string, number>,
  partial: boolean,
): string {
  const listCounts = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([label, n]) => `- ${label} (${n})`)
      .join('\n');
  const total = entries.length;
  const decade = (entry: CatalogEntry) => (entry.releaseYear ? `${Math.floor(entry.releaseYear / 10) * 10}s` : 'unknown');
  const arabic = entries.filter((entry) => entry.slice === 'ar');
  const sections = [
    `# Demo catalog — build report`,
    ``,
    `Generated by \`src/scripts/fetch-catalog.ts\` on ${new Date().toISOString().slice(0, 10)}${partial ? ' (**partial run**; the fixture was not rewritten)' : ''}.`,
    `Rows in list: ${rows.length} · entries resolved this run: ${total} · warnings: ${warnings.length}.`,
    ``,
    `## Balance`,
    ``,
    table(count(entries, (entry) => entry.slice), ['Slice', 'Titles'], total),
    ``,
    table(count(entries, (entry) => entry.tier), ['Tier', 'Titles'], total),
    ``,
    table(count(entries, (entry) => entry.region), ['Region', 'Titles'], total),
    ``,
    table(count(entries, decade), ['Decade', 'Titles'], total),
    ``,
    `Arabic slice: ${arabic.length} titles, ${arabic.filter((entry) => (entry.releaseYear ?? 9999) < 2000).length} released before 2000, ${arabic.filter((entry) => ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'].includes(entry.region)).length} from the Gulf.`,
    ``,
    table(count(entries, (entry) => entry.originalLanguage ?? 'unknown'), ['Original language (Wikidata P364, first)', 'Titles'], total),
    ``,
    `## Coverage`,
    ``,
    `| Field | Present | Missing |`,
    `|---|---|---|`,
    `| Arabic title | ${total} | ${rows.length - total} (excluded) |`,
    `| description (en) | ${entries.filter((entry) => entry.description).length} | ${entries.filter((entry) => !entry.description).length} |`,
    `| descriptionAr | ${entries.filter((entry) => entry.descriptionAr).length} | ${entries.filter((entry) => !entry.descriptionAr).length} |`,
    `| genres | ${entries.filter((entry) => entry.genres.length > 0).length} | ${entries.filter((entry) => entry.genres.length === 0).length} |`,
    `| IMDb id | ${entries.filter((entry) => entry.externalIds.imdb).length} | ${entries.filter((entry) => !entry.externalIds.imdb).length} |`,
    `| TMDB id | ${entries.filter((entry) => entry.externalIds.tmdb).length} | ${entries.filter((entry) => !entry.externalIds.tmdb).length} |`,
    `| plot section | ${entries.filter((entry) => entry.evidence.plotSource && !entry.evidence.plotSource.endsWith(':lead')).length} | ${entries.filter((entry) => !entry.evidence.plotSource || entry.evidence.plotSource.endsWith(':lead')).length} |`,
    `| arwiki article | ${entries.filter((entry) => entry.evidence.wikipedia.ar).length} | ${entries.filter((entry) => !entry.evidence.wikipedia.ar).length} |`,
    ``,
    `## Genre vocabulary`,
    ``,
    table(count(entries.flatMap((entry) => entry.genres.map((genre) => ({ genre }))), (item) => item.genre), ['Genre', 'Titles'], total),
    ``,
    unknownGenres.size > 0
      ? `Wikidata genre labels folded in by keyword (not in \`GENRE_MAP\`; add an explicit entry to override the fold):\n\n${listCounts(unknownGenres)}`
      : `Every Wikidata genre label was in \`GENRE_MAP\`.`,
    ``,
    droppedGenres.size > 0 ? `Wikidata labels dropped as production tags, not genres:\n\n${listCounts(droppedGenres)}` : `No genre label was dropped.`,
    ``,
    `| Description source | Titles |`,
    `|---|---|`,
    `| English Wikipedia lead | ${entries.filter((entry) => entry.descriptionSource === 'wikipedia:en').length} |`,
    `| Wikidata stub (use descriptionAr) | ${entries.filter((entry) => entry.descriptionSource === 'wikidata').length} |`,
    `| none | ${entries.filter((entry) => entry.descriptionSource === null).length} |`,
    ``,
    `## Warnings (${warnings.length})`,
    ``,
    warnings.length === 0 ? 'None.' : ['| Id | Title | Kind | Detail |', '|---|---|---|---|', ...warnings.map((warning) => `| ${warning.internalId} | ${warning.titleEn} | ${warning.kind} | ${warning.detail.replace(/\|/g, '\\|')} |`)].join('\n'),
    ``,
  ];
  return sections.join('\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
