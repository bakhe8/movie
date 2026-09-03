// Mirrors packages/shared/src/types.ts's FilmFingerprintV1. Kept as a local
// copy rather than a cross-package import: apps/backend's tsconfig has a
// fixed rootDir (./src) for its tsc build, and pulling in another
// workspace package's source directly breaks that without a real
// project-reference/composite build setup, which is more infrastructure
// than a JSON column's shape currently warrants (see
// docs/movie_taste_platform_blueprint_ar.md section 12: keep the monolith
// simple until there's an actual reason not to). Keep both copies in sync
// by hand until there's a second consumer that justifies a shared build.
export interface FilmFingerprintV1 {
  schemaVersion: 'film-fingerprint-v1';

  pacing: number;
  rhythmVariance: number;

  ambiguity: number;
  psychologicalDepth: number;
  warmth: number;
  darkness: number;

  linearity: number;
  dialogueDensity: number;
  actionIntensity: number;
  plotComplexity: number;

  visualComplexity: number;
  soundscapeComplexity: number;
  colorSaturation: number;

  themes: string[];

  confidence: {
    pacing?: number;
    ambiguity?: number;
    psychologicalDepth?: number;
    [key: string]: number | undefined;
  };

  generatedBy?: string;
  generatedAt?: Date;
  modelVersion?: string;

  // Provenance -- who/what produced this fingerprint and whether it may be
  // used commercially. Absence means unknown, not "no rights"/"no source".
  sourceIds?: string[];
  extractorVersion?: string;
  licenseStatus?: 'commercial_allowed' | 'non_commercial_only' | 'unknown';
  reviewStatus?: 'unreviewed' | 'sampled' | 'human_reviewed';

  // First V2 family pass (FINGERPRINT_SCHEMA.md §3.1, ADR-69): 15 namespaced
  // "family.feature" dimensions nested here rather than flattened into the
  // top level -- V1 stays frozen and untouched, every existing reader of the
  // 13 fields above keeps working unmodified. Optional: a title enriched
  // with V1 only (no v2 block yet, true of the original 15 seed titles) is
  // valid and unaffected for scoring (unknown dimensions are imputed, same
  // as any missing V1 one) -- only training requires the complete 28-vector.
  v2?: FilmFingerprintV2;
}

export const FINGERPRINT_V2_DIMENSIONS = [
  'narrative.revelation',
  'narrative.perspective',
  'narrative.unreliability',
  'tone.irony',
  'tone.unease',
  'tone.catharsis',
  'tone.compassion',
  'characters.agency',
  'characters.moralAmbiguity',
  'characters.transformation',
  'characters.relationshipCentrality',
  'ending.openness',
  'ending.twist',
  'ending.justice',
  'ending.optimism',
] as const;
export type FilmFingerprintV2Dimension = (typeof FINGERPRINT_V2_DIMENSIONS)[number];

export interface FilmFingerprintV2 {
  schemaVersion: 'film-fingerprint-v2';
  features: Record<FilmFingerprintV2Dimension, number>;
  themes: string[];
  confidence: Partial<Record<FilmFingerprintV2Dimension, number>>;

  generatedBy?: string;
  generatedAt?: Date;
  modelVersion?: string;
  extractorVersion?: string;
  sourceIds?: string[];
  licenseStatus?: 'commercial_allowed' | 'non_commercial_only' | 'unknown';
  reviewStatus?: 'unreviewed' | 'sampled' | 'human_reviewed';
}
