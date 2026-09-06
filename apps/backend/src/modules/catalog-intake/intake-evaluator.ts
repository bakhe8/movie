// CAT-J1 (ADR-121): the `intake-v1` completeness evaluator. Pure -- no HTTP,
// no database -- so every rule is unit-tested in isolation. It answers ONE
// question: may this candidate be admitted into `titles` by a human? It
// never decides publication: that stays `public-v1` (PublicationPolicyService),
// computed by the server after admission, exactly as today.
//
// Same shape as `PublicationEvaluation` (versioned, explicit blocker codes,
// fail closed, never a silent default) so the control center renders both
// with one component. Codes are split into blocking (admission refused) and
// advisory (recorded, shown, but not a refusal) -- and `POSSIBLE_DUPLICATE`
// is deliberately blocking: ADR-116 forbids automatic merge or deletion, so
// a suspected duplicate waits for a person, always.

export const INTAKE_EVALUATOR_VERSION = 'intake-v1';

export type IntakeBlockerCode =
  // identity layer (CAT-2's own admission gate: all three provider ids, mutually consistent)
  | 'IDENTITY_WIKIDATA_MISSING'
  | 'IDENTITY_IMDB_MISSING'
  | 'IDENTITY_TMDB_MISSING'
  | 'IDENTITY_FORMAT_INVALID'
  | 'IDENTITY_CROSS_SOURCE_MISMATCH'
  | 'NOT_A_FILM'
  | 'YEAR_MISMATCH'
  // content layer (what public-v1 will need after admission; checked early so a hopeless candidate is visible now)
  | 'TITLE_EN_MISSING'
  | 'TITLE_AR_MISSING'
  | 'DESCRIPTION_MISSING'
  | 'GENRES_MISSING'
  | 'POSTER_MISSING'
  | 'YEAR_MISSING'
  // duplicate layer
  | 'DUPLICATE_OF_TITLE'
  | 'POSSIBLE_DUPLICATE'
  // transient
  | 'SOURCE_FETCH_FAILED'
  // advisory only
  | 'GENRES_UNMAPPED'
  | 'DESCRIPTION_FROM_STUB'
  | 'FINGERPRINT_MISSING';

export const ADVISORY_CODES: ReadonlySet<IntakeBlockerCode> = new Set<IntakeBlockerCode>([
  'GENRES_UNMAPPED',
  'DESCRIPTION_FROM_STUB',
  'FINGERPRINT_MISSING',
]);

// Same spellings `CatalogIdentityGuards` and `catalog-identity.ts` enforce.
export const ID_FORMATS = {
  wikidata: /^Q[1-9]\d*$/,
  imdb: /^tt\d{7,}$/,
  tmdb: /^[1-9]\d*$/,
} as const;

export interface IntakeCandidate {
  wikidataId?: string | null;
  imdbId?: string | null;
  tmdbId?: string | null;
  titleEn?: string | null;
  titleAr?: string | null;
  description?: string | null;
  /** True when the English description is only a Wikidata stub ("1955 film"), not a Wikipedia lead. */
  descriptionIsStub?: boolean;
  releaseYear?: number | null;
  genres?: readonly string[] | null;
  /** Wikidata genre labels no vocabulary rule could fold -- advisory, unless it left `genres` empty. */
  unmappedGenres?: readonly string[] | null;
  posterPath?: string | null;
  /** Result of the P31 class check: true = a film class, false = something else, null/undefined = not checked. */
  isFilm?: boolean | null;
  /** The year the discovery criteria expected (a curated list, a SPARQL result); compared to `releaseYear` within +/-1 like fetch-catalog.ts. */
  expectedYear?: number | null;
  /** The IMDb id TMDB itself reports for `tmdbId` (`GET /movie/{id}`.imdb_id); null = TMDB has none, undefined = not checked. */
  imdbIdFromTmdb?: string | null;
  /** `titles.internalId` of an existing work sharing a provider id -- an exact duplicate, resolved by a human. */
  duplicateOfTitle?: string | null;
  /** A soft match (same normalized title and year +/-1) against `titles` or another intake row. */
  possibleDuplicateOf?: string | null;
  /** The last source fetch for this candidate failed (429/5xx/network); the row is retried, never judged on stale data. */
  sourceFetchFailed?: boolean;
  fingerprintPresent?: boolean | null;
}

export interface IntakeEvaluation {
  evaluatorVersion: typeof INTAKE_EVALUATOR_VERSION;
  blockerCodes: IntakeBlockerCode[];
  /** Codes that refuse admission (everything not in ADVISORY_CODES). */
  blocking: IntakeBlockerCode[];
  advisory: IntakeBlockerCode[];
  /** True only when no blocking code fired. */
  admissible: boolean;
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateIntake(candidate: IntakeCandidate): IntakeEvaluation {
  const codes: IntakeBlockerCode[] = [];
  const push = (code: IntakeBlockerCode) => {
    if (!codes.includes(code)) codes.push(code);
  };

  if (candidate.sourceFetchFailed) {
    push('SOURCE_FETCH_FAILED');
  }

  // Identity: all three, well-formed, and agreeing with each other.
  if (!present(candidate.wikidataId)) push('IDENTITY_WIKIDATA_MISSING');
  else if (!ID_FORMATS.wikidata.test(candidate.wikidataId)) push('IDENTITY_FORMAT_INVALID');
  if (!present(candidate.imdbId)) push('IDENTITY_IMDB_MISSING');
  else if (!ID_FORMATS.imdb.test(candidate.imdbId)) push('IDENTITY_FORMAT_INVALID');
  if (!present(candidate.tmdbId)) push('IDENTITY_TMDB_MISSING');
  else if (!ID_FORMATS.tmdb.test(candidate.tmdbId)) push('IDENTITY_FORMAT_INVALID');
  if (candidate.imdbIdFromTmdb !== undefined && present(candidate.imdbId) && candidate.imdbIdFromTmdb !== candidate.imdbId) {
    // TMDB knows this tmdb id as a different film (or as none): the two
    // sources disagree about which work this is. Never pick a side here.
    push('IDENTITY_CROSS_SOURCE_MISMATCH');
  }
  if (candidate.isFilm === false) push('NOT_A_FILM');

  // Content.
  if (!present(candidate.titleEn)) push('TITLE_EN_MISSING');
  // Never transliterated, never translated: an Arabic title comes from a
  // source (Wikidata label, arwiki page, cited override) or stays missing.
  if (!present(candidate.titleAr)) push('TITLE_AR_MISSING');
  if (!present(candidate.description)) push('DESCRIPTION_MISSING');
  else if (candidate.descriptionIsStub) push('DESCRIPTION_FROM_STUB');
  if (!candidate.genres || candidate.genres.length === 0) push('GENRES_MISSING');
  else if (candidate.unmappedGenres && candidate.unmappedGenres.length > 0) push('GENRES_UNMAPPED');
  if (!present(candidate.posterPath)) push('POSTER_MISSING');
  if (typeof candidate.releaseYear !== 'number') push('YEAR_MISSING');
  else if (typeof candidate.expectedYear === 'number' && Math.abs(candidate.releaseYear - candidate.expectedYear) > 1) push('YEAR_MISMATCH');

  // Duplicates: exact (a provider id already in `titles`) or suspected.
  if (present(candidate.duplicateOfTitle)) push('DUPLICATE_OF_TITLE');
  if (present(candidate.possibleDuplicateOf)) push('POSSIBLE_DUPLICATE');

  if (candidate.fingerprintPresent === false) push('FINGERPRINT_MISSING');

  const blocking = codes.filter((code) => !ADVISORY_CODES.has(code));
  const advisory = codes.filter((code) => ADVISORY_CODES.has(code));
  return { evaluatorVersion: INTAKE_EVALUATOR_VERSION, blockerCodes: codes, blocking, advisory, admissible: blocking.length === 0 };
}

/**
 * The intake status a fresh evaluation implies. `admitted` is never derived
 * here -- only the (human-triggered, G1-gated) admit step sets it.
 */
export function statusFor(evaluation: IntakeEvaluation): 'verified' | 'blocked' | 'duplicate' {
  if (evaluation.blocking.includes('DUPLICATE_OF_TITLE')) return 'duplicate';
  return evaluation.admissible ? 'verified' : 'blocked';
}

// Soft duplicate key: lower-cased Latin letters and digits only, so
// "Sátántangó (1994)" and "Satantango" collide on purpose and are shown to a
// reviewer. Anything Arabic or otherwise non-Latin is folded to its own
// letters unchanged apart from case and whitespace.
export function normalizeTitleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s*\((?:\d{4}|film|فيلم|فلم)[^)]*\)\s*$/iu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface DuplicateProbe {
  key: string;
  year: number | null;
  ref: string;
}

/**
 * The first existing work whose normalized title matches and whose year is
 * within +/-1 (or unknown on either side). Purely advisory input for
 * `POSSIBLE_DUPLICATE`; never a merge decision.
 */
export function findPossibleDuplicate(
  candidate: { titleEn?: string | null; releaseYear?: number | null },
  existing: readonly DuplicateProbe[],
): string | null {
  if (!present(candidate.titleEn)) return null;
  const key = normalizeTitleKey(candidate.titleEn);
  if (!key) return null;
  for (const row of existing) {
    if (row.key !== key) continue;
    if (typeof candidate.releaseYear === 'number' && typeof row.year === 'number' && Math.abs(candidate.releaseYear - row.year) > 1) continue;
    return row.ref;
  }
  return null;
}
