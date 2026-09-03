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
}
