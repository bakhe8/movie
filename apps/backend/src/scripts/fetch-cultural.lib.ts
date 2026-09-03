/**
 * Pure building blocks of the cultural-context block (FINGERPRINT_SCHEMA.md
 * §3.4, BP §6.1 "السياق الثقافي", §10.2): facts read from Wikidata claims —
 * original language, production country, where and when the story is set —
 * never inferred by a model, never part of the dense content vector, and
 * never a statement about the viewer. Everything here is deterministic given
 * the entities, so the unit tests pin it and `fetch-cultural.ts` stays a thin
 * fetcher/writer.
 */

export const CULTURAL_SCHEMA_VERSION = 'film-cultural-v1';
export const CULTURAL_EXTRACTOR_VERSION = 'catalog-cultural-v1';

/** Wikidata properties read here. */
export const CP = {
  originalLanguage: 'P364',
  country: 'P495',
  narrativeLocation: 'P840',
  setInPeriod: 'P2408',
  countryOfPlace: 'P17',
  startTime: 'P580',
  endTime: 'P582',
  pointInTime: 'P585',
  iso639_1: 'P218',
  iso639_3: 'P220',
  iso3166_alpha2: 'P297',
} as const;

export interface WdSnak {
  mainsnak?: { datavalue?: { value?: unknown } };
  rank?: 'preferred' | 'normal' | 'deprecated';
  qualifiers?: Record<string, unknown[]>;
}
export interface WdEntity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  claims?: Record<string, WdSnak[]>;
}

export interface SettingPlace {
  id: string;
  label: string;
  /**
   * ISO 3166-1 alpha-2 of the place's country — every P17 statement that holds
   * now (a contested region lists each state that claims it, none is picked),
   * or the place's own code when it is a country; empty when Wikidata has none
   * (fictional places, oceans, historical entities).
   */
  countries: string[];
}
export interface SettingEra {
  id: string;
  label: string;
  start: number | null;
  end: number | null;
}

export interface CulturalBlock {
  schemaVersion: typeof CULTURAL_SCHEMA_VERSION;
  /** ISO 639-1 where one exists (every Arabic variety → 'ar'), else 639-3, else the English label. P364, in claim order. */
  originalLanguages: string[];
  /** ISO 3166-1 alpha-2 (P495 → P297), else the English label. */
  productionCountries: string[];
  settingPlaces: SettingPlace[];
  /** Distinct countries of the setting places, in place order. */
  settingCountries: string[];
  settingEras: SettingEra[];
  /** Wikidata does not model the dialect of a film's dialogue; unknown, never guessed (BP §11.3). */
  dialects: null;
  generatedBy: 'wikidata';
  generatedAt: string;
  extractorVersion: typeof CULTURAL_EXTRACTOR_VERSION;
  sourceIds: string[];
  /** Wikidata statements are CC0 (DATA_LICENSING.md): storing, deriving and displaying them is allowed in every phase. */
  licenseStatus: 'commercial_allowed';
  reviewStatus: 'unreviewed';
}

export interface CulturalEntry {
  internalId: string;
  titleEn: string;
  externalIds: { wikidata: string };
  originalLanguage?: string | null;
  country?: string | null;
  slice?: string;
  tier?: string;
  fingerprint?: Record<string, unknown> | null;
  cultural?: CulturalBlock | null;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export function claimIds(entity: WdEntity | undefined, property: string): string[] {
  return (entity?.claims?.[property] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { id: string } => typeof value === 'object' && value !== null && 'id' in value)
    .map((value) => value.id);
}

/**
 * Item ids of the statements that hold *now*: deprecated ones and ones with an
 * end-time qualifier (P582) are skipped, preferred-rank ones come first. Used
 * for a place's country (P17), where Wikidata keeps history — a city that
 * changed hands lists each state with dates, and only the current one is the
 * setting's country.
 */
export function currentClaimIds(entity: WdEntity | undefined, property: string): string[] {
  const statements = (entity?.claims?.[property] ?? []).filter(
    (snak) => snak.rank !== 'deprecated' && !(snak.qualifiers && Array.isArray(snak.qualifiers[CP.endTime]) && snak.qualifiers[CP.endTime].length > 0),
  );
  const ordered = [...statements.filter((snak) => snak.rank === 'preferred'), ...statements.filter((snak) => snak.rank !== 'preferred')];
  return ordered
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { id: string } => typeof value === 'object' && value !== null && 'id' in value)
    .map((value) => value.id);
}

export function claimStrings(entity: WdEntity | undefined, property: string): string[] {
  return (entity?.claims?.[property] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is string => typeof value === 'string');
}

/** The year of a Wikidata time value ("+1950-00-00T00:00:00Z"), or null. */
export function claimYear(entity: WdEntity | undefined, property: string): number | null {
  const years = (entity?.claims?.[property] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is { time: string } => typeof value === 'object' && value !== null && 'time' in value)
    .map((value) => {
      const match = /^([+-])(\d{1,6})/.exec(value.time);
      return match ? Number(match[2]) * (match[1] === '-' ? -1 : 1) : NaN;
    })
    .filter((year) => Number.isFinite(year));
  return years.length > 0 ? years[0] : null;
}

/** The ids a film entity references for the block: languages, countries, places, periods. */
export function referencedIds(entity: WdEntity | undefined): string[] {
  return [
    ...new Set([
      ...claimIds(entity, CP.originalLanguage),
      ...claimIds(entity, CP.country),
      ...claimIds(entity, CP.narrativeLocation),
      ...claimIds(entity, CP.setInPeriod),
    ]),
  ];
}

/** The countries the setting places point at (P17), fetched in a second pass. */
export function placeCountryIds(places: string[], referenced: Record<string, WdEntity>): string[] {
  return [...new Set(places.flatMap((id) => claimIds(referenced[id], CP.countryOfPlace)))];
}

// ---------------------------------------------------------------------------
// Codes and labels
// ---------------------------------------------------------------------------

export function labelOf(entity: WdEntity | undefined, fallback: string): string {
  return entity?.labels?.en?.value ?? fallback;
}

/** Same rule as fetch-catalog.ts: every Arabic variety is 'ar', every English variety 'en', else 639-1, 639-3, label. */
export function languageCodeOf(id: string, referenced: Record<string, WdEntity>): string {
  const entity = referenced[id];
  const label = labelOf(entity, id);
  if (/\barabic\b/i.test(label)) {
    return 'ar';
  }
  if (/\benglish\b/i.test(label)) {
    return 'en';
  }
  return claimStrings(entity, CP.iso639_1)[0]?.toLowerCase() ?? claimStrings(entity, CP.iso639_3)[0]?.toLowerCase() ?? label;
}

export function countryCodeOf(id: string, referenced: Record<string, WdEntity>): string {
  const entity = referenced[id];
  return claimStrings(entity, CP.iso3166_alpha2)[0]?.toUpperCase() ?? labelOf(entity, id);
}

export function settingPlaceOf(id: string, referenced: Record<string, WdEntity>): SettingPlace {
  const entity = referenced[id];
  const own = claimStrings(entity, CP.iso3166_alpha2)[0]?.toUpperCase();
  const viaCountry = currentClaimIds(entity, CP.countryOfPlace)
    .map((countryId) => claimStrings(referenced[countryId], CP.iso3166_alpha2)[0]?.toUpperCase())
    .filter((code): code is string => typeof code === 'string');
  return { id, label: labelOf(entity, id), countries: own ? [own] : [...new Set(viaCountry)] };
}

/**
 * Years for a period item: its own P580/P582 (or P585) first; otherwise the
 * label's shape — "1950s", "19th century", "1942" — else unknown. A named era
 * without dates ("Cold War" carries P580/P582 on Wikidata; "Victorian era"
 * too) is kept by label alone when neither applies.
 */
export function settingEraOf(id: string, referenced: Record<string, WdEntity>): SettingEra {
  const entity = referenced[id];
  const label = labelOf(entity, id);
  let start = claimYear(entity, CP.startTime);
  let end = claimYear(entity, CP.endTime);
  if (start === null && end === null) {
    const point = claimYear(entity, CP.pointInTime);
    if (point !== null) {
      start = end = point;
    }
  }
  if (start === null && end === null) {
    const decade = /^(\d{3})0s$/.exec(label);
    const century = /^(\d{1,2})(?:st|nd|rd|th) century$/i.exec(label);
    const year = /^(\d{4})$/.exec(label);
    if (decade) {
      start = Number(decade[1]) * 10;
      end = start + 9;
    } else if (century) {
      start = (Number(century[1]) - 1) * 100 + 1;
      end = start + 99;
    } else if (year) {
      start = end = Number(year[1]);
    }
  }
  return { id, label, start, end };
}

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

export function culturalBlockFor(qid: string, entity: WdEntity | undefined, referenced: Record<string, WdEntity>, now: Date): CulturalBlock {
  const places = claimIds(entity, CP.narrativeLocation).map((id) => settingPlaceOf(id, referenced));
  return {
    schemaVersion: CULTURAL_SCHEMA_VERSION,
    originalLanguages: [...new Set(claimIds(entity, CP.originalLanguage).map((id) => languageCodeOf(id, referenced)))],
    productionCountries: [...new Set(claimIds(entity, CP.country).map((id) => countryCodeOf(id, referenced)))],
    settingPlaces: places,
    settingCountries: [...new Set(places.flatMap((place) => place.countries))],
    settingEras: claimIds(entity, CP.setInPeriod).map((id) => settingEraOf(id, referenced)),
    dialects: null,
    generatedBy: 'wikidata',
    generatedAt: now.toISOString(),
    extractorVersion: CULTURAL_EXTRACTOR_VERSION,
    sourceIds: [`wikidata:${qid}`],
    licenseStatus: 'commercial_allowed',
    reviewStatus: 'unreviewed',
  };
}

export function needsCultural(entry: CulturalEntry, force = false): boolean {
  return force || entry.cultural?.extractorVersion !== CULTURAL_EXTRACTOR_VERSION;
}

// ---------------------------------------------------------------------------
// Coverage per language / country / slice / tier (BP §11.3, §16.1)
// ---------------------------------------------------------------------------

export interface CoverageRow {
  key: string;
  titles: number;
  withPlace: number;
  withEra: number;
  v1Complete: number;
  withV2: number;
  withV3: number;
  meanV1Confidence: number | null;
}

const V1_KEYS = [
  'pacing',
  'rhythmVariance',
  'ambiguity',
  'psychologicalDepth',
  'warmth',
  'darkness',
  'linearity',
  'dialogueDensity',
  'actionIntensity',
  'plotComplexity',
  'visualComplexity',
  'soundscapeComplexity',
  'colorSaturation',
];

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function coverageBy(entries: CulturalEntry[], keyOf: (entry: CulturalEntry) => string): CoverageRow[] {
  const groups = new Map<string, CulturalEntry[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const confidences = members.flatMap((entry) => {
        const confidence = (entry.fingerprint?.confidence as Record<string, unknown> | undefined) ?? {};
        return Object.values(confidence).filter(isNumber);
      });
      return {
        key,
        titles: members.length,
        withPlace: members.filter((entry) => (entry.cultural?.settingPlaces.length ?? 0) > 0).length,
        withEra: members.filter((entry) => (entry.cultural?.settingEras.length ?? 0) > 0).length,
        v1Complete: members.filter((entry) => V1_KEYS.every((key) => isNumber(entry.fingerprint?.[key]))).length,
        withV2: members.filter((entry) => typeof entry.fingerprint?.v2 === 'object' && entry.fingerprint?.v2 !== null).length,
        withV3: members.filter((entry) => typeof entry.fingerprint?.v3 === 'object' && entry.fingerprint?.v3 !== null).length,
        meanV1Confidence: confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
      };
    })
    .sort((left, right) => right.titles - left.titles || left.key.localeCompare(right.key));
}

export function coverageTable(title: string, rows: CoverageRow[]): string {
  const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)} %` : '—');
  return [
    `| ${title} | Titles | Setting place | Setting era | V1 complete | V2 | V3 | Mean V1 confidence |`,
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.titles} | ${pct(row.withPlace, row.titles)} | ${pct(row.withEra, row.titles)} | ${pct(row.v1Complete, row.titles)} | ` +
        `${pct(row.withV2, row.titles)} | ${pct(row.withV3, row.titles)} | ${row.meanV1Confidence === null ? '—' : row.meanV1Confidence.toFixed(2)} |`,
    ),
  ].join('\n');
}

export function buildCulturalReport(entries: CulturalEntry[], generatedOn: string, fetched: number): string {
  const withBlock = entries.filter((entry) => entry.cultural);
  const withPlace = withBlock.filter((entry) => entry.cultural!.settingPlaces.length > 0);
  const withEra = withBlock.filter((entry) => entry.cultural!.settingEras.length > 0);
  const placeCountryUnknown = withBlock.filter((entry) => entry.cultural!.settingPlaces.some((place) => place.countries.length === 0));
  const eraUndated = withBlock.filter((entry) => entry.cultural!.settingEras.some((era) => era.start === null && era.end === null));
  const setElsewhere = withBlock.filter(
    (entry) =>
      entry.cultural!.settingCountries.length > 0 &&
      entry.cultural!.productionCountries.length > 0 &&
      !entry.cultural!.settingCountries.some((code) => entry.cultural!.productionCountries.includes(code)),
  );
  const list = (items: CulturalEntry[]) => (items.length === 0 ? 'None.' : items.map((entry) => `${entry.internalId} ${entry.titleEn}`).join(' · '));
  return [
    '# Demo catalog — cultural context block and coverage report',
    '',
    `Generated by \`src/scripts/fetch-cultural.ts\` on ${generatedOn} (\`${CULTURAL_EXTRACTOR_VERSION}\`, facts from Wikidata, CC0).`,
    `Entries: ${entries.length} · with block: ${withBlock.length} · fetched this run: ${fetched} · with a setting place (P840): ${withPlace.length} · with a setting era (P2408): ${withEra.length}.`,
    '',
    '## What the block holds',
    '',
    '- `originalLanguages` (P364, ISO 639-1; every Arabic variety → `ar`), `productionCountries` (P495 → ISO 3166-1 alpha-2), `settingPlaces` (P840, with the countries whose P17 statement holds now — a contested region lists every claimant, none is picked), `settingCountries`, `settingEras` (P2408, dated from the item\'s own P580/P582/P585 or from a decade/century/year label).',
    '- `dialects` is `null` for every title: Wikidata does not model the dialect of a film\'s dialogue. Unknown, never guessed.',
    '- Nothing here enters the taste vector or describes a viewer (BP §10.2: UI language and nationality never enter taste). The block is a separate factual block with its own place in the model (FINGERPRINT_SCHEMA.md §3.2) and the basis of the coverage tables below (BP §11.3, §16.1).',
    '',
    '## Coverage by original language (first P364)',
    '',
    coverageTable('Language', coverageBy(entries, (entry) => entry.cultural?.originalLanguages[0] ?? entry.originalLanguage ?? 'unknown')),
    '',
    '## Coverage by production country (first P495)',
    '',
    coverageTable('Country', coverageBy(entries, (entry) => entry.cultural?.productionCountries[0] ?? entry.country ?? 'unknown')),
    '',
    '## Coverage by slice and tier',
    '',
    coverageTable('Slice', coverageBy(entries, (entry) => entry.slice ?? 'unknown')),
    '',
    coverageTable('Tier', coverageBy(entries, (entry) => entry.tier ?? 'unknown')),
    '',
    '## Setting country by production country',
    '',
    `Stories set outside their production country (${setElsewhere.length}): ${list(setElsewhere)}`,
    '',
    '## Review items (facts Wikidata lacks; nothing was invented)',
    '',
    `- No setting place (${withBlock.length - withPlace.length}): ${list(withBlock.filter((entry) => entry.cultural!.settingPlaces.length === 0))}`,
    `- No setting era (${withBlock.length - withEra.length}): ${list(withBlock.filter((entry) => entry.cultural!.settingEras.length === 0))}`,
    `- Setting place without a country (${placeCountryUnknown.length}): ${list(placeCountryUnknown)}`,
    `- Setting era without dates (${eraUndated.length}): ${list(eraUndated)}`,
    '',
  ].join('\n');
}
