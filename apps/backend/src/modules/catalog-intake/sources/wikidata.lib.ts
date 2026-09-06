import type { IntakeProvenance } from '../../../entities/catalog-intake.entity';
import type { DiscoveredCandidate, DiscoveryCriteria, ResolvedFacts, SourceFact } from './catalog-source';

// CAT-J1 (ADR-121): pure building blocks for the Wikidata adapter -- no
// HTTP here, so every rule is unit-tested with a recorded entity.
//
// The vocabulary below (properties, film classes, genre map, keyword
// fallback, sentence rules) MIRRORS `src/scripts/fetch-catalog.ts`, which
// cannot be imported (it runs its main() at load time) and may not be edited
// by this scope (board CAT-J1). `wikidata.lib.spec.ts` reads that file as
// text and fails if the two genre maps or film-class sets drift, so the
// server-side intake and the fixture builder keep speaking one vocabulary
// until an approved extraction lets fetch-catalog.ts import this file.

export const WD_P = {
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

export const FILM_CLASSES: ReadonlySet<string> = new Set([
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

export const ANIMATION_CLASSES: ReadonlySet<string> = new Set(['Q202866', 'Q20650540', 'Q29168811', 'Q31235', 'Q63952888']);

// Wikidata genre label (English, lower-case) -> the app's genre vocabulary.
// Meta-genres that describe production rather than content map to [] and are dropped.
export const GENRE_MAP: Record<string, string[]> = {
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
  docudrama: ['Documentary', 'Drama'],
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
  tragedy: ['Drama'],
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
  remake: [],
  sequel: [],
  'film sequel': [],
  prequel: [],
  'ensemble film': [],
  'arthouse film': [],
  'short film': [],
  'live-action film': [],
  'film in the public domain': [],
};

// Keyword fallback for the long tail of Wikidata sub-genres; a label matching
// nothing is a production tag, not a genre, and is dropped (reported as unmapped).
export const GENRE_KEYWORDS: [RegExp, string[]][] = [
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
export const MAX_GENRES = 4;
export const DESCRIPTION_MAX_CHARS = 400;

export interface GenreMapping {
  genres: string[];
  /** Labels folded only by the keyword fallback (kept, but worth a human glance). */
  unknown: string[];
  /** Labels no rule could fold: dropped. */
  dropped: string[];
}

export function mapGenres(labels: readonly string[]): GenreMapping {
  const genres: string[] = [];
  const unknown: string[] = [];
  const dropped: string[] = [];
  for (const label of labels) {
    const mapped = GENRE_MAP[label.toLowerCase()];
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
  return { genres: [...new Set(genres)].slice(0, MAX_GENRES), unknown, dropped };
}

// --- Wikidata entity shapes (wbgetentities) --------------------------------

export interface WdSnak {
  mainsnak?: { datavalue?: { value?: unknown } };
}
export interface WdEntity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, WdSnak[]>;
  sitelinks?: Record<string, { title: string }>;
}
export interface WdEntitiesResponse {
  entities?: Record<string, WdEntity>;
}

export function claimIds(entity: WdEntity, property: string): string[] {
  return (entity.claims?.[property] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { id: string } => typeof value === 'object' && value !== null && 'id' in value)
    .map((value) => value.id);
}

export function claimStrings(entity: WdEntity, property: string): string[] {
  return (entity.claims?.[property] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is string => typeof value === 'string');
}

export function earliestYear(entity: WdEntity): number | null {
  const years = (entity.claims?.[WD_P.publicationDate] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { time: string } => typeof value === 'object' && value !== null && 'time' in value)
    .map((value) => Number(/^[+-]?(\d{4})/.exec(value.time)?.[1]))
    .filter((year) => Number.isFinite(year) && year > 1880);
  return years.length > 0 ? Math.min(...years) : null;
}

export function stripArabicDisambiguation(title: string): string {
  return title.replace(/\s*\((?:فيلم|فلم)[^)]*\)\s*$/u, '').trim();
}

export function capAtSentence(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('؟ '), cut.lastIndexOf('! '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
}

export function firstSentences(text: string | undefined | null, count: number): string | null {
  if (!text) {
    return null;
  }
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const sentences = cleaned.split(/(?<=[.!?؟])\s+(?=[^a-z])/u).filter(Boolean);
  const picked = sentences.slice(0, count).join(' ');
  return picked ? capAtSentence(picked, DESCRIPTION_MAX_CHARS) : null;
}

// --- Provenance -----------------------------------------------------------

export const WIKIDATA_LICENSE = 'CC0 1.0';
export const WIKIPEDIA_LICENSE = 'CC BY-SA 4.0 (attribution and share-alike; verbatim text stays under the same license)';

export function wikidataUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${qid}`;
}

export function wikipediaUrl(lang: string, page: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`;
}

export function wikidataProvenance(qid: string, retrievedAt: Date): IntakeProvenance {
  return { source: 'wikidata', license: WIKIDATA_LICENSE, licenseStatus: 'commercial_allowed', url: wikidataUrl(qid), retrievedAt: retrievedAt.toISOString() };
}

export function wikipediaProvenance(lang: string, page: string, retrievedAt: Date): IntakeProvenance {
  return {
    source: `wikipedia:${lang}`,
    license: WIKIPEDIA_LICENSE,
    licenseStatus: 'commercial_allowed',
    url: wikipediaUrl(lang, page),
    retrievedAt: retrievedAt.toISOString(),
  };
}

// --- Facts from one entity --------------------------------------------------

export interface ReferencedLookup {
  /** English label of a referenced item (genre, language, country), or the id itself when unknown. */
  labelOf: (id: string) => string;
  /** A string claim of a referenced item (ISO codes), lower-cased, or null. */
  codeOf: (id: string, property: string) => string | null;
}

export function referencedLookup(referenced: Record<string, WdEntity>): ReferencedLookup {
  return {
    labelOf: (id) => referenced[id]?.labels?.en?.value ?? id,
    codeOf: (id, property) => claimStrings(referenced[id] ?? { id }, property)[0]?.toLowerCase() ?? null,
  };
}

// Wikidata files most films under a variety ("Egyptian Arabic", "Classical
// Arabic"...) with an ISO 639-3 code but no 639-1 code; the catalog speaks
// ISO 639-1, so every Arabic variety is 'ar'.
export function languageCodeOf(id: string, lookup: ReferencedLookup): string {
  const label = lookup.labelOf(id);
  if (/\barabic\b/i.test(label)) return 'ar';
  if (/\benglish\b/i.test(label)) return 'en';
  return lookup.codeOf(id, WD_P.iso639_1) ?? lookup.codeOf(id, WD_P.iso639_3) ?? label;
}

export interface WikipediaLeads {
  /** The English article's lead paragraph (plain text), when an enwiki sitelink exists and was fetched. */
  en?: string | null;
  ar?: string | null;
}

/**
 * Everything one Wikidata entity (plus its referenced items and the two
 * Wikipedia leads) says about a film, each fact with its provenance. The
 * English title is Wikidata's label -- there is no curated list here to
 * prefer -- and is kept separately as `labelEn` evidence when a discovery
 * title differed. Never invents: a missing Arabic label/arwiki page leaves
 * `titleAr` null for the evaluator to refuse.
 */
export function factsFromEntity(entity: WdEntity, lookup: ReferencedLookup, leads: WikipediaLeads, retrievedAt: Date): ResolvedFacts {
  const warnings: string[] = [];
  const qid = entity.id;
  const wd = wikidataProvenance(qid, retrievedAt);
  const fact = <T>(value: T, provenance: IntakeProvenance = wd): SourceFact<T> => ({ value, provenance });

  const classes = claimIds(entity, WD_P.instanceOf);
  const isFilm = classes.length === 0 ? null : classes.some((id) => FILM_CLASSES.has(id));
  if (isFilm === false) warnings.push(`not-a-film-class: P31 = ${classes.join(', ')}`);

  const year = earliestYear(entity);
  if (year === null) warnings.push('no-year: no P577 publication date');

  const enSitelink = entity.sitelinks?.enwiki?.title ?? null;
  const arSitelink = entity.sitelinks?.arwiki?.title ?? null;
  const labelEn = entity.labels?.en?.value ?? null;
  const titleEn = labelEn ?? enSitelink;
  const titleArRaw = entity.labels?.ar?.value ?? (arSitelink ? stripArabicDisambiguation(arSitelink) : null);
  if (!titleArRaw) warnings.push('no-arabic-title: no Arabic label and no arwiki page');

  const languages = [...new Set(claimIds(entity, WD_P.originalLanguage).map((id) => languageCodeOf(id, lookup)))];
  if (languages.length === 0) warnings.push('no-language: no P364');
  const countries = claimIds(entity, WD_P.country).map((id) => lookup.codeOf(id, WD_P.iso3166_alpha2)?.toUpperCase() ?? lookup.labelOf(id));

  const isAnimated = classes.some((id) => ANIMATION_CLASSES.has(id));
  const mapped = mapGenres(claimIds(entity, WD_P.genre).map((id) => lookup.labelOf(id)));
  const genres = [...(isAnimated ? ['Animation'] : []), ...mapped.genres.filter((genre) => genre !== 'Animation')].slice(0, MAX_GENRES);
  if (genres.length === 0) warnings.push('no-genre: no P136 genre mapped');

  const imdb = claimStrings(entity, WD_P.imdb)[0] ?? null;
  const tmdb = claimStrings(entity, WD_P.tmdb)[0] ?? null;

  const enLead = firstSentences(leads.en, 2);
  const stub = entity.descriptions?.en?.value ?? null;
  const description = enLead ?? stub;
  const descriptionIsStub = !enLead && !!stub;
  if (descriptionIsStub) warnings.push(`description-from-wikidata: "${stub}"`);
  const arLead = firstSentences(leads.ar, 2) ?? entity.descriptions?.ar?.value ?? null;

  return {
    wikidataId: qid,
    imdbId: imdb,
    tmdbId: tmdb,
    titleEn: titleEn ? fact(titleEn) : null,
    titleAr: titleArRaw ? fact(titleArRaw, entity.labels?.ar?.value || !arSitelink ? wd : wikipediaProvenance('ar', arSitelink, retrievedAt)) : null,
    description: description ? fact(description, enLead && enSitelink ? wikipediaProvenance('en', enSitelink, retrievedAt) : wd) : null,
    descriptionIsStub,
    descriptionAr: arLead ? fact(arLead, leads.ar && arSitelink ? wikipediaProvenance('ar', arSitelink, retrievedAt) : wd) : null,
    releaseYear: year !== null ? fact(year) : null,
    genres: genres.length > 0 ? fact(genres) : null,
    unmappedGenres: [...mapped.unknown, ...mapped.dropped],
    originalLanguage: languages[0] ? fact(languages[0]) : null,
    countries: countries.length > 0 ? fact(countries) : null,
    isFilm,
    labelEn,
    warnings,
  };
}

// --- Discovery (SPARQL) -----------------------------------------------------

export const DEFAULT_MIN_SITELINKS = 6;
export const DEFAULT_DISCOVERY_LIMIT = 50;
export const MAX_DISCOVERY_LIMIT = 200;

/**
 * The same shape CAT-2's sourcing rounds used (`catalog-dev1000-source-round5.ts`):
 * films (P31 subclass of Q11424) from the given countries, with IMDb and TMDB
 * ids present -- the intake identity gate needs all three anyway, so asking
 * only for candidates that can pass it saves every later request.
 */
export function buildDiscoverySparql(criteria: DiscoveryCriteria): string {
  const countries = (criteria.countryQids ?? []).filter((qid) => /^Q[1-9]\d*$/.test(qid));
  if (countries.length === 0) throw new Error('discovery needs at least one valid country QID');
  const limit = Math.min(Math.max(1, Math.trunc(criteria.limit ?? DEFAULT_DISCOVERY_LIMIT)), MAX_DISCOVERY_LIMIT);
  const minSitelinks = Math.max(0, Math.trunc(criteria.minSitelinks ?? DEFAULT_MIN_SITELINKS));
  const yearFilters: string[] = [];
  if (typeof criteria.yearFrom === 'number') yearFilters.push(`?year >= ${Math.trunc(criteria.yearFrom)}`);
  if (typeof criteria.yearTo === 'number') yearFilters.push(`?year <= ${Math.trunc(criteria.yearTo)}`);
  return `
SELECT ?film ?filmLabel ?imdb ?tmdb ?year ?sitelinks ?langLabel WHERE {
  VALUES ?country { ${countries.map((qid) => `wd:${qid}`).join(' ')} }
  ?film wdt:P31/wdt:P279* wd:Q11424 .
  ?film wdt:P495 ?country .
  ?film wdt:P345 ?imdb .
  ?film wdt:P4947 ?tmdb .
  ?film wdt:P577 ?date .
  BIND(YEAR(?date) AS ?year)
  ${yearFilters.length > 0 ? `FILTER(${yearFilters.join(' && ')})` : ''}
  ?film wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= ${minSitelinks})
  OPTIONAL { ?film wdt:P364 ?lang }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sitelinks)
LIMIT ${limit}`.trim();
}

export interface SparqlResponse {
  results?: { bindings?: Record<string, { value: string }>[] };
}

const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';

/** One candidate per QID (first binding wins), minus excluded original languages. */
export function parseDiscoveryBindings(response: SparqlResponse, criteria: DiscoveryCriteria, source: string): DiscoveredCandidate[] {
  const exclude = new Set((criteria.excludeOriginalLanguages ?? ['english']).map((label) => label.toLowerCase()));
  const seen = new Set<string>();
  const rows: DiscoveredCandidate[] = [];
  const snapshot: Record<string, unknown> = {
    ...(criteria.slice ? { slice: criteria.slice } : {}),
    ...(criteria.reason ? { reason: criteria.reason } : {}),
    ...(criteria.countryQids ? { countryQids: criteria.countryQids } : {}),
    ...(criteria.minSitelinks !== undefined ? { minSitelinks: criteria.minSitelinks } : {}),
    ...(criteria.yearFrom !== undefined ? { yearFrom: criteria.yearFrom } : {}),
    ...(criteria.yearTo !== undefined ? { yearTo: criteria.yearTo } : {}),
  };
  for (const binding of response.results?.bindings ?? []) {
    const qid = binding.film?.value?.startsWith(ENTITY_PREFIX) ? binding.film.value.slice(ENTITY_PREFIX.length) : null;
    if (!qid || seen.has(qid)) continue;
    seen.add(qid);
    const lang = binding.langLabel?.value ?? null;
    if (lang && exclude.has(lang.toLowerCase())) continue;
    const year = Number(binding.year?.value);
    const sitelinks = Number(binding.sitelinks?.value);
    rows.push({
      source,
      wikidataId: qid,
      imdbId: binding.imdb?.value ?? null,
      tmdbId: binding.tmdb?.value ?? null,
      titleEn: binding.filmLabel?.value ?? null,
      year: Number.isFinite(year) ? year : null,
      sitelinks: Number.isFinite(sitelinks) ? sitelinks : null,
      originalLanguageLabel: lang,
      criteria: snapshot,
    });
  }
  return rows;
}

// --- Wikipedia lead (action API) -------------------------------------------

export interface WikiPagePropsResponse {
  query?: {
    pages?: { title?: string; extract?: string; missing?: boolean; pageprops?: { wikibase_item?: string; disambiguation?: string } }[];
  };
}

export function wikipediaLeadUrl(lang: string, title: string): string {
  return (
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|pageprops&exintro=1&explaintext=1` +
    `&ppprop=wikibase_item|disambiguation&redirects=1&titles=${encodeURIComponent(title.replace(/ /g, '_'))}&format=json&formatversion=2`
  );
}

/** The lead paragraph, only when the page exists, is not a disambiguation, and points at the expected Wikidata item. */
export function parseWikipediaLead(response: WikiPagePropsResponse | null, expectedQid: string): string | null {
  const page = response?.query?.pages?.[0];
  if (!page || page.missing || page.pageprops?.disambiguation !== undefined) return null;
  if (page.pageprops?.wikibase_item !== expectedQid) return null; // the sitelink drifted to another item: not evidence about this film
  return page.extract?.trim() ? page.extract : null;
}

export function entitiesUrl(ids: readonly string[], props: string, languages: string, sitefilter?: string): string {
  return (
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}` +
    `&props=${props}&languages=${languages}${sitefilter ? `&sitefilter=${sitefilter}` : ''}&format=json`
  );
}

export function sparqlUrl(query: string): string {
  return `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
}
