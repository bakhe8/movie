/**
 * FilmFingerprintV1: Core schema for analyzing and categorizing films
 * Version: 1.0
 * Defines approximately 30-50 semantic dimensions of film characteristics
 */

export interface FilmFingerprintV1 {
  schemaVersion: 'film-fingerprint-v1';
  
  // Tempo and Rhythm (0-1 scale)
  pacing: number;
  rhythmVariance: number;
  
  // Emotional/Thematic
  ambiguity: number;
  psychologicalDepth: number;
  warmth: number;
  darkness: number;
  
  // Narrative Structure
  linearity: number;
  dialogueDensity: number;
  actionIntensity: number;
  plotComplexity: number;
  
  // Aesthetic
  visualComplexity: number;
  soundscapeComplexity: number;
  colorSaturation: number;
  
  // Themes
  themes: string[];
  
  // Confidence scores per dimension
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

export interface TriadResponse {
  userId: string;
  triadId: string;
  
  // Three titles in the triad
  titleIds: [string, string, string];
  
  // Ranking: indices representing 1st, 2nd, 3rd place
  ranking: [number, number, number];
  
  // Display order on screen
  displayOrder: [number, number, number];
  
  // Metadata
  sessionId: string;
  timestamp: Date;
  
  // Replacements for "haven't watched"
  replacements?: Record<string, string>;
  
  // Why this triad was selected
  reasonForSelection?: string;
  
  // Which model version created this triad
  modelVersion?: string;
}

export interface UserPreferenceModel {
  userId: string;
  
  // Taste weights (linear combination with fingerprints)
  weights: {
    pacing: number;
    ambiguity: number;
    psychologicalDepth: number;
    warmth: number;
    [key: string]: number;
  };
  
  // Per-user bias term
  biasTerms?: {
    [titleId: string]: number;
  };
  
  // Model metadata
  modelVersion: string;
  trainingCount: number;
  lastUpdated: Date;
}

export interface Recommendation {
  userId: string;
  titleId: string;
  
  // Score from user preference model
  score: number;
  
  // Primary reasons for recommendation
  topReasons: {
    dimension: string;
    weight: number;
    contribution: number;
  }[];
  
  // Similar titles that influenced this recommendation
  similarTitles?: string[];
  
  // Explanation for user
  explanation: string;
  
  // Confidence in recommendation
  confidence: number;
}

export interface UserProfile {
  userId: string;
  email: string;
  
  // User preferences
  preferredLanguage: 'ar' | 'en';
  
  // Watched titles
  watchedTitles: string[];
  
  // Not watched (user explicitly marked)
  notWatchedTitles: string[];
  
  // Preferred genres
  preferredGenres?: string[];
}
