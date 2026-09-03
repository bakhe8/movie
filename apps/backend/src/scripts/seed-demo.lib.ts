/**
 * Pure building blocks of the demo seed (docs/DEMO_DATA_PLAN_2026-09-03.md WS3).
 * No I/O, no TypeORM: everything here is deterministic given a seed, so the
 * unit tests pin the behaviour and `seed-demo.ts` stays a thin writer.
 *
 * The persona model: a hidden taste vector θ over the 13 fingerprint
 * dimensions; utility u = θ·x with unknown dimensions imputed at the
 * midpoint (never zero, ADR-19); a triad ranking is an exact Plackett–Luce
 * sample — utility / τ plus Gumbel noise, best first — so the learner's own
 * assumption holds and accuracy lands around 0.8–0.9, not 1.0.
 */
import type { FilmFingerprintV1 } from '../entities/title-fingerprint.type';
import type { Title } from '../entities/title.entity';

export const DIMENSIONS = [
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
] as const;

export interface PersonaSpec {
  slug: string;
  nameAr: string;
  nameEn: string;
  taste: string;
  theta: number[];
  watched: number;
  triads: number;
  watchlist: number;
  notWatched: number;
  notes: number;
  importedRatings: number;
  replacements: { notRemembered: number; notWatched: number };
  includePartialTitle: boolean;
  activeTriad: boolean;
  expectedBand: 'inconclusive' | 'initial' | 'likely' | 'strong';
}

export interface PersonasFixture {
  emailDomain: string;
  password: string;
  seed: number;
  temperature: number;
  policyVersion: string;
  personas: PersonaSpec[];
}

/** The catalog fixture entry as `fetch-catalog.ts` writes it (entity fields plus fixture-only ones). */
export interface CatalogEntry {
  internalId: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  descriptionSource?: 'wikipedia:en' | 'wikidata' | null;
  descriptionAr?: string | null;
  releaseYear: number | null;
  genres: string[];
  originalLanguage?: string | null;
  externalIds: { wikidata: string; imdb?: string; tmdb?: string };
  fingerprint: (Partial<FilmFingerprintV1> & Record<string, unknown>) | null;
}

// `originalLanguage` is typed here rather than picked from `Title` so this
// module compiles on a checkout where that column has not landed yet; the
// writer drops the key when the entity metadata has no such column.
export type TitleSeedRow = Pick<Title, 'internalId' | 'titleEn' | 'titleAr' | 'description' | 'releaseYear' | 'genres' | 'externalIds' | 'fingerprint'> & {
  originalLanguage?: string | null;
};

export type Rng = () => number;

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, good enough for fixtures; same seed → same stream. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string → 32-bit seed, so each persona gets its own stream from one base seed. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  return shuffle(rng, items).slice(0, Math.max(0, Math.min(count, items.length)));
}

/** Standard Gumbel(0, 1) draw: -log(-log(U)). */
export function gumbel(rng: Rng): number {
  const u = Math.min(Math.max(rng(), 1e-12), 1 - 1e-12);
  return -Math.log(-Math.log(u));
}

// ---------------------------------------------------------------------------
// Fingerprints and utility
// ---------------------------------------------------------------------------

/** The 13 dimensions in model order; a missing or non-finite value is `null` (unknown), never 0. */
export function fingerprintVector(fingerprint: CatalogEntry['fingerprint']): (number | null)[] {
  return DIMENSIONS.map((dimension) => {
    const value = fingerprint?.[dimension];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
}

export function isCompleteFingerprint(fingerprint: CatalogEntry['fingerprint']): boolean {
  return fingerprintVector(fingerprint).every((value) => value !== null);
}

/** θ·x with unknown dimensions imputed at the 0.5 midpoint (ADR-19: unknown ≠ zero). */
export function utility(theta: readonly number[], vector: readonly (number | null)[]): number {
  if (theta.length !== DIMENSIONS.length || vector.length !== DIMENSIONS.length) {
    throw new Error(`utility() expects ${DIMENSIONS.length}-dimensional inputs`);
  }
  return theta.reduce((total, weight, index) => total + weight * (vector[index] ?? 0.5), 0);
}

// ---------------------------------------------------------------------------
// Sampling the persona's world
// ---------------------------------------------------------------------------

/**
 * The persona's watched set: `likeRatio` of it drawn from the upper half of
 * the catalog by utility, the rest from the lower half, so the personal
 * ranking has something to order and the persona is not a caricature. A
 * zero θ makes both halves arbitrary, which is the point of that persona.
 */
export function sampleWatched(
  rng: Rng,
  entries: readonly CatalogEntry[],
  theta: readonly number[],
  count: number,
  options: { likeRatio?: number; mustInclude?: readonly string[] } = {},
): CatalogEntry[] {
  const likeRatio = options.likeRatio ?? 0.7;
  const mustInclude = new Set(options.mustInclude ?? []);
  const scored = entries
    .map((entry) => ({ entry, score: utility(theta, fingerprintVector(entry.fingerprint)) }))
    .sort((left, right) => right.score - left.score || left.entry.internalId.localeCompare(right.entry.internalId));
  const half = Math.ceil(scored.length / 2);
  const upper = scored.slice(0, half).map((item) => item.entry);
  const lower = scored.slice(half).map((item) => item.entry);

  const forced = entries.filter((entry) => mustInclude.has(entry.internalId));
  const remaining = Math.max(0, count - forced.length);
  const fromUpper = Math.round(remaining * likeRatio);
  const fromLower = remaining - fromUpper;
  const picked = [
    ...forced,
    ...sample(
      rng,
      upper.filter((entry) => !mustInclude.has(entry.internalId)),
      fromUpper,
    ),
    ...sample(
      rng,
      lower.filter((entry) => !mustInclude.has(entry.internalId)),
      fromLower,
    ),
  ];
  // Top up from wherever is left if a half was too small.
  if (picked.length < count) {
    const chosen = new Set(picked.map((entry) => entry.internalId));
    picked.push(...sample(rng, entries.filter((entry) => !chosen.has(entry.internalId)), count - picked.length));
  }
  return shuffle(rng, picked);
}

/**
 * Three distinct eligible ids, never all three of the immediately previous
 * triad (the random-v1 policy's one-triad lookback, ADR-34). Returns null when
 * fewer than three eligible titles remain.
 */
export function sampleTriad(
  rng: Rng,
  eligibleIds: readonly string[],
  previousIds: readonly string[],
  options: { mustInclude?: string } = {},
): [string, string, string] | null {
  const previous = new Set(previousIds);
  const pool = eligibleIds.filter((id) => !previous.has(id));
  if (pool.length < 3) {
    return null;
  }
  if (options.mustInclude && pool.includes(options.mustInclude)) {
    const rest = sample(
      rng,
      pool.filter((id) => id !== options.mustInclude),
      2,
    );
    return shuffle(rng, [options.mustInclude, ...rest]) as [string, string, string];
  }
  return sample(rng, pool, 3) as [string, string, string];
}

/** Exact Plackett–Luce sample: sort by utility/τ + Gumbel, best first (title ids, ADR-15). */
export function rankByUtility(
  rng: Rng,
  titleIds: readonly string[],
  utilityById: ReadonlyMap<string, number>,
  temperature: number,
): string[] {
  const tau = temperature > 0 ? temperature : 1e-6;
  return [...titleIds]
    .map((id) => ({ id, score: (utilityById.get(id) ?? 0) / tau + gumbel(rng) }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.id);
}

/** C(n, k) as a float, for selectionPropensity = 1 / C(pool, 3). */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = (result * (n - k + index)) / index;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** `count` watch dates spread over the past `months`, oldest first, none in the future. */
export function spreadWatchedDates(rng: Rng, count: number, now: Date, months = 18): Date[] {
  const span = months * 30 * DAY_MS;
  const dates = Array.from({ length: count }, () => new Date(now.getTime() - rng() * span));
  return dates.sort((left, right) => left.getTime() - right.getTime());
}

/**
 * Triad timestamps in sittings of `sessionSize` on distinct days within the
 * past `days`, ascending; inside a sitting each triad is answered 40–90 s
 * after it was shown and the next one is shown right after. Ascending
 * answeredAt is what the trainer's temporal hold-out relies on (ADR-31).
 */
export function sessionTimestamps(
  rng: Rng,
  count: number,
  now: Date,
  options: { sessionSize?: number; days?: number } = {},
): { shownAt: Date; answeredAt: Date; sessionIndex: number }[] {
  const sessionSize = options.sessionSize ?? 5;
  const days = options.days ?? 60;
  const sessions = Math.max(1, Math.ceil(count / sessionSize));
  // Distinct day offsets, most recent session ending before `now`.
  const offsets = new Set<number>();
  while (offsets.size < sessions) {
    offsets.add(1 + Math.floor(rng() * Math.max(days, sessions)));
  }
  const starts = [...offsets]
    .sort((left, right) => right - left)
    .map((offset) => new Date(now.getTime() - offset * DAY_MS + Math.floor(rng() * 12 * 60 * 60 * 1000)));
  const result: { shownAt: Date; answeredAt: Date; sessionIndex: number }[] = [];
  let sessionIndex = 0;
  let cursor = starts[0];
  for (let index = 0; index < count; index += 1) {
    if (index > 0 && index % sessionSize === 0) {
      sessionIndex += 1;
      cursor = starts[sessionIndex];
    }
    const shownAt = new Date(cursor.getTime());
    const answeredAt = new Date(shownAt.getTime() + (40 + Math.floor(rng() * 51)) * 1000);
    result.push({ shownAt, answeredAt, sessionIndex });
    cursor = new Date(answeredAt.getTime() + 2000);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fixture → entity
// ---------------------------------------------------------------------------

/**
 * Only `titles` entity fields; the Arabic lead replaces a Wikidata stub
 * description; `originalLanguage` is the fixture's first Wikidata P364 code
 * (ISO 639-1, Arabic varieties folded to `ar`), NULL when Wikidata had none.
 */
export function catalogEntryToTitle(entry: CatalogEntry): TitleSeedRow {
  const description = entry.descriptionSource === 'wikidata' && entry.descriptionAr ? entry.descriptionAr : entry.description;
  return {
    internalId: entry.internalId,
    titleEn: entry.titleEn,
    titleAr: entry.titleAr,
    description: description ?? null,
    releaseYear: entry.releaseYear ?? null,
    genres: entry.genres ?? [],
    originalLanguage: entry.originalLanguage ?? null,
    externalIds: entry.externalIds,
    fingerprint: (entry.fingerprint as FilmFingerprintV1 | null) ?? null,
  } as TitleSeedRow;
}

// ---------------------------------------------------------------------------
// Provenance rows (content_features, BP §13.3 / FINGERPRINT_SCHEMA.md §3)
// ---------------------------------------------------------------------------

export interface FeatureRow {
  titleId: string;
  featureKey: string;
  value: number;
  uncertainty: number | null;
  sourceIds: string[];
  extractorVersion: string;
  licenseStatus: string;
  reviewStatus: string;
  validFrom: Date;
}

function parseWhen(value: unknown, fallback: Date): Date {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
}

/**
 * One row per known feature of a published snapshot: the 13 V1 keys that are
 * present (a missing dimension gets no row — unknown is not a value) and the
 * V2 block's namespaced keys. `uncertainty` is 1 − the extractor's confidence
 * where it reported one, NULL otherwise. Provenance fields are copied from
 * the block that produced the value, never invented here.
 */
export function featureRowsFor(entry: CatalogEntry, titleId: string, now: Date): FeatureRow[] {
  const fingerprint = entry.fingerprint;
  if (!fingerprint || typeof fingerprint !== 'object') {
    return [];
  }
  const rows: FeatureRow[] = [];
  const blocks: { keys: readonly string[]; values: Record<string, unknown>; confidence: Record<string, unknown>; meta: Record<string, unknown> }[] = [];
  blocks.push({
    keys: DIMENSIONS,
    values: fingerprint as Record<string, unknown>,
    confidence: ((fingerprint as Record<string, unknown>).confidence as Record<string, unknown>) ?? {},
    meta: fingerprint as Record<string, unknown>,
  });
  const v2 = (fingerprint as Record<string, unknown>).v2;
  if (v2 && typeof v2 === 'object') {
    const block = v2 as Record<string, unknown>;
    const features = (block.features as Record<string, unknown>) ?? {};
    blocks.push({ keys: Object.keys(features), values: features, confidence: (block.confidence as Record<string, unknown>) ?? {}, meta: block });
  }
  for (const block of blocks) {
    const extractorVersion = typeof block.meta.extractorVersion === 'string' ? block.meta.extractorVersion : null;
    if (!extractorVersion) {
      continue; // a snapshot without an extractor version has no provenance to record
    }
    for (const key of block.keys) {
      const value = block.values[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue;
      }
      const confidence = block.confidence[key];
      rows.push({
        titleId,
        featureKey: key,
        value,
        uncertainty: typeof confidence === 'number' && Number.isFinite(confidence) ? Math.round((1 - confidence) * 1000) / 1000 : null,
        sourceIds: Array.isArray(block.meta.sourceIds) ? block.meta.sourceIds.filter((id): id is string => typeof id === 'string') : [],
        extractorVersion,
        licenseStatus: typeof block.meta.licenseStatus === 'string' ? block.meta.licenseStatus : 'unknown',
        reviewStatus: typeof block.meta.reviewStatus === 'string' ? block.meta.reviewStatus : 'unreviewed',
        validFrom: parseWhen(block.meta.generatedAt, now),
      });
    }
  }
  return rows;
}

export function validateCatalogEntry(entry: CatalogEntry): string[] {
  const problems: string[] = [];
  if (!/^DEMO\d{4}$/.test(entry.internalId ?? '')) {
    problems.push('internalId must look like DEMO0001');
  }
  if (!entry.titleEn) {
    problems.push('titleEn missing');
  }
  if (!entry.titleAr) {
    problems.push('titleAr missing');
  }
  if (!entry.externalIds?.wikidata) {
    problems.push('externalIds.wikidata missing');
  }
  if (entry.fingerprint !== null && typeof entry.fingerprint !== 'object') {
    problems.push('fingerprint must be an object or null');
  }
  return problems;
}

export function validatePersona(persona: PersonaSpec): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(persona.slug)) {
    problems.push(`${persona.slug}: slug must be lower-case kebab`);
  }
  if (persona.theta.length !== DIMENSIONS.length) {
    problems.push(`${persona.slug}: theta must have ${DIMENSIONS.length} values`);
  }
  if (persona.watched < 3) {
    problems.push(`${persona.slug}: at least 3 watched titles are needed for a triad`);
  }
  const reserved = persona.replacements.notRemembered + persona.replacements.notWatched + (persona.includePartialTitle ? 1 : 0);
  if (persona.watched - reserved < 3) {
    problems.push(`${persona.slug}: watched minus replacement reservations must leave 3 eligible titles`);
  }
  return problems;
}

// Sample notes in both languages; nothing about the film's quality, only a watch fact (§4.5: no rating prompt).
export const SAMPLE_NOTES = [
  'شاهدته في السينما مع أخي.',
  'أعدت مشاهدته بعد سنوات.',
  'Watched on a long flight.',
  'شاهدته على دفعتين.',
  'Recommended by a friend at work.',
  'نمت في منتصفه أول مرة.',
  'Saw it at a festival screening.',
] as const;
