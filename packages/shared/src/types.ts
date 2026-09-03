/**
 * Shared TypeScript contracts.
 *
 * These mirror the backend entities and the API shapes documented in
 * docs/API.md §1. They are the reference copy: apps/backend keeps a local copy
 * of FilmFingerprintV1 (apps/backend/src/entities/title-fingerprint.type.ts) and
 * apps/frontend keeps its own client types (apps/frontend/app/lib/api.ts) until a
 * project-reference build exists (ADR-1). Keep all three in sync by hand.
 *
 * Product rules these types encode (docs/movie_taste_platform_blueprint_ar.md):
 * - §2.4 #2: no rating type anywhere; the only explicit preference signal is a
 *   triad ranking. `importedRating` is import-only auxiliary data (§4.2).
 * - §4.4: Personal Fit, Public Quality, Watchability and Confidence are four
 *   separate values; there is deliberately no merged `score`.
 * - §4.1, §10.2: UI language is display/market only, never a taste prior; there
 *   is deliberately no `preferredGenres`.
 */

/**
 * FilmFingerprintV1 -- frozen (docs/FINGERPRINT_SCHEMA.md §2).
 * Thirteen numeric features on a 0-1 scale plus themes, confidence and provenance.
 */
export interface FilmFingerprintV1 {
  schemaVersion: 'film-fingerprint-v1';

  // Rhythm
  pacing: number;
  rhythmVariance: number;

  // Tone / narrative
  ambiguity: number;
  psychologicalDepth: number;
  warmth: number;
  darkness: number;

  // Narrative structure
  linearity: number;
  dialogueDensity: number;
  actionIntensity: number;
  plotComplexity: number;

  // Style
  visualComplexity: number;
  soundscapeComplexity: number;
  colorSaturation: number;

  // Free text, not part of the model vector
  themes: string[];

  // Confidence per feature; an empty object means unknown for every feature
  confidence: {
    pacing?: number;
    ambiguity?: number;
    psychologicalDepth?: number;
    [key: string]: number | undefined;
  };

  // Metadata
  generatedBy?: string;
  generatedAt?: Date;
  modelVersion?: string;

  // Provenance -- who/what produced this fingerprint and whether it may be
  // used commercially. Absence means unknown, not "no rights"/"no source".
  // See docs/movie_taste_platform_blueprint_ar.md section 13.3.
  sourceIds?: string[];
  extractorVersion?: string;
  licenseStatus?: 'commercial_allowed' | 'non_commercial_only' | 'unknown';
  reviewStatus?: 'unreviewed' | 'sampled' | 'human_reviewed';
}

export type PreferredLanguage = 'ar' | 'en';

/** Pseudonymous taste profile (blueprint §13.1, §21.1). */
export interface Profile {
  id: string;
  userId: string;
  name: string;
  preferredLanguage: PreferredLanguage;
  createdAt: string;
  updatedAt: string;
}

export interface Title {
  id: string;
  internalId: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  releaseYear: number | null;
  genres: string[] | null;
  externalIds?: { imdb?: string; tmdb?: string; wikidata?: string } | null;
  fingerprint?: FilmFingerprintV1 | null;
}

/** Exposure / list state. `not_watched` = unknown exposure, never a negative signal (§2.4 #3). */
export type TitleState = 'watched' | 'not_watched' | 'watchlist' | 'interested';

export interface UserTitleState {
  id: string;
  profileId: string;
  titleId: string;
  state: TitleState;
  watchedAt: string | null;
  importedRating: number | null;
  ratingSource: 'import' | null;
  notes: string | null;
  updatedAt: string;
  title?: Title;
}

export type TriadStatus = 'active' | 'completed' | 'skipped';

/** One listwise triad event (blueprint §7.2, §13.2). */
export interface Triad {
  id: string;
  profileId: string;
  titleIds: string[];
  displayOrder: string[] | null;
  ranking: number[] | null;
  policyVersion: string | null;
  selectionPropensity: number | null;
  experimentId: string | null;
  sessionId: string | null;
  status: TriadStatus;
  createdAt: string;
}

export type ConfidenceBand = 'initial' | 'likely' | 'strong' | 'inconclusive';
export type RecommendationTrack = 'safe' | 'discovery' | 'outside_usual';

export interface Recommendation {
  title: Title;
  personalFitScore: number;
  publicQualityScore: number | null;
  watchabilityScore: number | null;
  confidenceBand: ConfidenceBand;
  fingerprintCoverage: number;
  track: RecommendationTrack;
  modelVersion: string;
}
