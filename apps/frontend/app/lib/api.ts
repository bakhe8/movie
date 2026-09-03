import type { PublicQuality, TextSource } from '../public-quality/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3101/api';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

export type PreferredLanguage = 'ar' | 'en';

// The closed purpose list (PRIVACY.md §3). email_recommendations and
// taste_card_sharing are reserved for later -- no feature asks for them yet,
// so the backend rejects them (blueprint gap 7).
export type ConsentPurpose =
  | 'terms_privacy'
  | 'watch_history'
  | 'personalization_individual'
  | 'personalization_pooled'
  | 'import_processing'
  | 'analytics_first_party';

// The policy text version this client currently shows -- matches PRIVACY.md's
// own "Version: 2.0" header, not an arbitrary string. Bump alongside that
// document; a version bump re-asks every purpose (PRIVACY.md §3).
export const CONSENT_VERSION = 'privacy-2.0';

export interface Consent {
  id: string;
  userId: string;
  purpose: ConsentPurpose;
  version: string;
  granted: boolean;
  grantedAt: string;
  revokedAt: string | null;
}

export interface Profile {
  id: string;
  userId: string;
  name: string;
  preferredLanguage: PreferredLanguage;
  // Onboarding (blueprint §4.1): display and availability only, never a
  // taste prior. `market` is ISO 3166-1 alpha-2; null until chosen -- the
  // onboarding screen shows while it is null.
  market: string | null;
  platforms: string[];
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
  // Display-only. Present only when the rights registry allows showing the
  // image (SCHEMA.md §5, DATA_LICENSING §4 rule 5); the API composes the URL,
  // the frontend never builds one. Absent or null: the poster slot is hollow.
  posterUrl?: string | null;
  // The attribution the image's source requires (e.g. TMDB), shown where the
  // image is shown (DATA_LICENSING §5).
  posterSource?: { name: string; attribution: string } | null;
  // Public Quality as GET /titles/:id returns it since 2026-09-04 (ALPHA_PLAN
  // 5.3): sources listed separately, never merged; null = no source yet.
  publicQuality?: PublicQuality | null;
  // The description's source from the rights registry (ALPHA_PLAN 5.1
  // follow-up); the page's SourcesFooter folds its credit. null = no row.
  descriptionSource?: TextSource | null;
}

export interface PaginatedTitles {
  items: Title[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type TitleState = 'watched' | 'not_watched' | 'watchlist' | 'interested';

export interface UserTitleState {
  id: string;
  profileId: string;
  titleId: string;
  state: TitleState;
  watchedAt: string | null;
  // false after a "don't remember" replacement (ADR-17): still watched, never
  // asked about in a triad again. Only the replace endpoint writes it.
  triadEligible: boolean;
  // Import-only, low-confidence auxiliary signal (blueprint §4.2) — never set via
  // setTitleState below. Present here only because the backend response includes it.
  importedRating: number | null;
  ratingSource: 'import' | null;
  notes: string | null;
  updatedAt: string;
  title?: Title;
}

export type TriadStatus = 'active' | 'completed' | 'skipped';

export interface Triad {
  id: string;
  profileId: string;
  titleIds: string[];
  displayOrder: string[] | null;
  // The three titles in displayOrder, so the screen renders in one round
  // trip (no fingerprint or external ids -- the catalog's public columns).
  items: Title[];
  // Title ids in ranked order, best-liked first -- not indices into
  // titleIds (ADR-15).
  ranking: string[] | null;
  shownAt: string | null;
  answeredAt: string | null;
  modelVersion: string | null;
  status: TriadStatus;
  createdAt: string;
}

// The two neutral reasons for swapping a triad item (blueprint §4.3, ADR-17).
// Deliberately no "didn't like it": the only preference signal is the ranking.
export type ReplacementReason = 'not_watched' | 'not_remembered';

export type ConfidenceBand = 'initial' | 'likely' | 'strong' | 'inconclusive';
export type RecommendationTrack = 'safe' | 'discovery' | 'outside_usual';

// Personal Fit, Public Quality, and Watchability stay three separate values, never
// merged into one score, and confidence is a verbal band rather than a raw
// percentage until calibrated (blueprint §4.4, §7.2, §9.3).
// The 13 fingerprint dimensions of FilmFingerprintV1 (FINGERPRINT_SCHEMA.md §2).
export type FingerprintDimension =
  | 'pacing'
  | 'rhythmVariance'
  | 'ambiguity'
  | 'psychologicalDepth'
  | 'warmth'
  | 'darkness'
  | 'linearity'
  | 'dialogueDensity'
  | 'actionIntensity'
  | 'plotComplexity'
  | 'visualComplexity'
  | 'soundscapeComplexity'
  | 'colorSaturation'
  // V2 families (FINGERPRINT_SCHEMA.md §3.1, ADR-69), namespaced `family.feature`.
  | 'narrative.revelation'
  | 'narrative.perspective'
  | 'narrative.unreliability'
  | 'tone.irony'
  | 'tone.unease'
  | 'tone.catharsis'
  | 'tone.compassion'
  | 'characters.agency'
  | 'characters.moralAmbiguity'
  | 'characters.transformation'
  | 'characters.relationshipCentrality'
  | 'ending.openness'
  | 'ending.twist'
  | 'ending.justice'
  | 'ending.optimism';

// Why a title ranks where it does (blueprint §9.4, ADR-20): only the
// dimensions that actually raised its score, as keys and a direction; the
// wording is composed here from fixed copy. `individual` in MVP (§5.3).
export interface RecommendationReason {
  features: { key: FingerprintDimension; direction: 'higher' | 'lower' }[];
  evidenceSource: 'individual' | 'population_enriched';
}

export interface Recommendation {
  title: Title;
  personalFitScore: number;
  publicQualityScore: number | null;
  watchabilityScore: number | null;
  confidenceBand: ConfidenceBand;
  // Fraction (0-1) of fingerprint dimensions known for this title; unknown ones
  // are imputed, never zero, and cost one confidence band (ADR-19).
  fingerprintCoverage: number;
  track: RecommendationTrack;
  modelVersion: string;
  reason: RecommendationReason;
}

// The library's personal ranking (blueprint §5.3): watched titles ordered by
// the same model that ranks recommendations. Positions only -- the API never
// sends the score, and the screen never shows a number (ADR-33).
export interface LibraryRankingItem {
  title: Title;
  position: number;
  confidenceBand: ConfidenceBand;
  fingerprintCoverage: number;
  modelVersion: string;
  // Why the model places it here, relative to the watched set (§9.4).
  reason: RecommendationReason;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    // The full error body: NestJS's `{ statusCode, message, error }` plus any
    // structured fields a route adds (e.g. `{ reason: 'need_more_watched',
    // needed }` from the triad endpoint), so screens can act on a reason
    // instead of parsing English prose.
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;

// Fired once per rejected token so the session provider can sign out.
export const UNAUTHORIZED_EVENT = 'reel:unauthorized';

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message || response.statusText;
    // A rejected token on any call, not only the first profile load (M4):
    // the session provider signs out so the door appears instead of every
    // screen failing one by one. Only 401 -- never a transient 5xx/429.
    if (response.status === 401 && authToken && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(message, response.status, typeof body === 'object' && body !== null ? body : {});
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  register: (data: { email: string; password: string; firstName: string; lastName: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  getProfiles: () => request<Profile[]>('/profiles'),

  createProfile: (data: { name: string; preferredLanguage?: PreferredLanguage }) =>
    request<Profile>('/profiles', { method: 'POST', body: JSON.stringify(data) }),

  updateProfile: (
    profileId: string,
    data: { name?: string; preferredLanguage?: PreferredLanguage; market?: string; platforms?: string[] },
  ) =>
    request<Profile>(`/profiles/${profileId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Cascades every event, mark and model snapshot of that profile (and only
  // that profile); the account stays.
  deleteProfile: (profileId: string) => request<void>(`/profiles/${profileId}`, { method: 'DELETE' }),

  getCompletedTriads: (profileId: string) => request<Triad[]>(`/profiles/${profileId}/triads`),

  listTitles: (query: string, page = 1, limit = 20) =>
    request<PaginatedTitles>(
      `/titles?${new URLSearchParams({ query, page: String(page), limit: String(limit) })}`,
    ),

  getTitle: (titleId: string) => request<Title>(`/titles/${titleId}`),

  // A genre-diverse, deterministic sample for a user with no marks yet
  // (blueprint §4.2); no taste input is involved.
  getStarterTitles: (limit = 12) => request<Title[]>(`/titles/starter?limit=${limit}`),

  // No `rating` here: the only explicit preference signal is a triad ranking (blueprint §2.4 #2).
  // `notes` omitted = left alone; `null` = cleared (PATCH semantics). Notes are
  // the user's private diary and never enter the model.
  setTitleState: (profileId: string, titleId: string, data: { state: TitleState; watchedAt?: string; notes?: string | null }) =>
    request<UserTitleState>(`/profiles/${profileId}/titles/${titleId}/state`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getWatchedTitles: (profileId: string) => request<UserTitleState[]>(`/profiles/${profileId}/watched-titles`),

  getWatchlist: (profileId: string) => request<UserTitleState[]>(`/profiles/${profileId}/watchlist`),

  // 409 until a model snapshot exists, like recommendations.
  getLibraryRanking: (profileId: string) => request<LibraryRankingItem[]>(`/profiles/${profileId}/library/ranking`),

  getCurrentTriad: (profileId: string) => request<Triad>(`/profiles/${profileId}/triads/current`),

  // `idempotencyKey` should be a fresh UUID per submit attempt (not per
  // retry) so a network retry or double-click safely returns the same
  // result instead of a "already submitted" error (ADR-15).
  rankTriad: (triadId: string, ranking: string[], idempotencyKey: string) =>
    request<Triad>(`/triads/${triadId}/rank`, {
      method: 'POST',
      body: JSON.stringify({ ranking }),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  // Swaps one item of the active triad for another watched title (ADR-17).
  // Returns the updated triad; `status: 'skipped'` means nothing eligible was
  // left to swap in and the caller should fetch the current triad again.
  replaceTriadItem: (triadId: string, titleId: string, reason: ReplacementReason) =>
    request<Triad>(`/triads/${triadId}/replace`, {
      method: 'POST',
      body: JSON.stringify({ titleId, reason }),
    }),

  getRecommendations: (profileId: string, limit = 10) =>
    request<Recommendation[]>(`/profiles/${profileId}/recommendations?limit=${limit}`),

  getConsents: () => request<Consent[]>('/consents'),

  // User-scoped, not profile-scoped (blueprint gap 7): terms_privacy is
  // asked at registration, before any profile exists (PRIVACY.md §3).
  // Upserts per (purpose, version); a repeat call with the same values is a
  // safe no-op.
  updateConsents: (consents: { purpose: ConsentPurpose; version: string; granted: boolean }[]) =>
    request<Consent[]>('/consents', { method: 'PUT', body: JSON.stringify({ consents }) }),
};
