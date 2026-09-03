/**
 * FilmFingerprintV1: Core schema for analyzing and categorizing films
 * Version: 1.0
 * Defines approximately 30-50 semantic dimensions of film characteristics
 */
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
    sourceIds?: string[];
    extractorVersion?: string;
    licenseStatus?: 'commercial_allowed' | 'non_commercial_only' | 'unknown';
    reviewStatus?: 'unreviewed' | 'sampled' | 'human_reviewed';
}
export interface TriadResponse {
    userId: string;
    triadId: string;
    titleIds: [string, string, string];
    ranking: [number, number, number];
    displayOrder: [number, number, number];
    sessionId: string;
    timestamp: Date;
    replacements?: Record<string, string>;
    reasonForSelection?: string;
    modelVersion?: string;
}
export interface UserPreferenceModel {
    userId: string;
    weights: {
        pacing: number;
        ambiguity: number;
        psychologicalDepth: number;
        warmth: number;
        [key: string]: number;
    };
    biasTerms?: {
        [titleId: string]: number;
    };
    modelVersion: string;
    trainingCount: number;
    lastUpdated: Date;
}
export interface Recommendation {
    userId: string;
    titleId: string;
    score: number;
    topReasons: {
        dimension: string;
        weight: number;
        contribution: number;
    }[];
    similarTitles?: string[];
    explanation: string;
    confidence: number;
}
export interface UserProfile {
    userId: string;
    email: string;
    preferredLanguage: 'ar' | 'en';
    watchedTitles: string[];
    notWatchedTitles: string[];
    preferredGenres?: string[];
}
//# sourceMappingURL=types.d.ts.map