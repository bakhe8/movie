import type { PublicQuality, TextSource } from '../public-quality/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3101/api';

export interface User {
  id: string;
  email: string;
  // Null for an account created since the door stopped asking (2026-09-05).
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
}

// Register/login reply (ADR-26): a short-lived access token and a rotating
// refresh token; the client keeps the pair and renews through /auth/refresh.
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: User;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export type PreferredLanguage = 'ar' | 'en';
export type PreferredAppearance = 'cinema' | 'premiere' | 'montage';

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
  preferredAppearance?: PreferredAppearance | null;
  // Onboarding (blueprint §4.1): display and availability only, never a
  // taste prior. `market` is ISO 3166-1 alpha-2; null until chosen -- the
  // onboarding screen shows while it is null.
  market: string | null;
  platforms: string[];
  // NULL = not paused; non-null = all processing paused by POST /privacy/pause.
  pausedAt: string | null;
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
  // POSTERS-MULTI P3/ADR-120: the full poster set for this title, index 0 the
  // same image as posterUrl, [] when none. Additive and optional -- absent on
  // a response that predates this field, never required by an existing
  // caller. Plumbing only for now (P4): nothing renders more than one image
  // yet (P5, pending an approved visual direction).
  posters?: { posterUrl: string; posterSource: { name: string; attribution: string } | null }[] | null;
  // Public Quality as GET /titles/:id returns it since 2026-09-04 (ALPHA_PLAN
  // 5.3): sources listed separately, never merged; null = no source yet.
  publicQuality?: PublicQuality | null;
  // The description's source from the rights registry (ALPHA_PLAN 5.1
  // follow-up); the page's SourcesFooter folds its credit. null = no row.
  descriptionSource?: TextSource | null;
  // Human-reviewed content dimensions as level bands (ADR-81); null = none reviewed.
  fingerprintSummary?: { key: string; level: 'low' | 'mid' | 'high' }[] | null;
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
  // Legacy bookkeeping timestamp; nothing renders it any more (ADR-104).
  watchedAt: string | null;
  // The calendar day the user watched it, plain 'YYYY-MM-DD' (ADR-104,
  // remediation brief DATE-01) -- format with formatWatchedOn, never
  // formatDate (that would let the viewer's own timezone shift the day).
  watchedOn: string | null;
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

// GET .../training `state`, and the `training.state` inside a pending
// recommendations answer: `disabled` = no model service on this server,
// `idle` = nothing requested yet, `unknown` = the service did not answer.
export type TrainingState = 'disabled' | 'paused' | 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
// 'invalid' = the ranked titles lack published fingerprints (nothing
// trainable yet); 'error' = the service itself failed.
export type TrainingErrorKind = 'invalid' | 'error' | null;
export interface TrainingSummary {
  state: TrainingState;
  jobId: string | null;
  errorKind: TrainingErrorKind;
  // Alias of `learningRounds` (ADR-108); the two round counts are optional
  // here only so a locally constructed summary need not restate them.
  completedTriads: number;
  learningRounds?: number;
  verificationRounds?: number;
  nextTrainingAt: number | null;
}

// ADR-103/114: four distinct capabilities. `eligible` means the system can
// start derived work; it never means the person must request that work.
export type ReadinessStatus = 'not_ready' | 'eligible' | 'queued' | 'processing' | 'ready' | 'failed' | 'stale';
export type ReadinessReason =
  | 'model_service_disabled'
  | 'processing_paused'
  | 'insufficient_triads'
  | 'insufficient_fingerprint_coverage'
  | 'insufficient_eligible_candidates'
  | 'model_service_error'
  | 'fingerprint_schema_changed'
  | 'no_availability_data_source'
  | null;
export type ReadinessAction = 'mark_watched_titles' | 'rank_more_triads' | 'resume_processing' | null;
export interface CapabilityReadiness {
  status: ReadinessStatus;
  reason: ReadinessReason;
  action: ReadinessAction;
  publishedAt: string | null;
  modelVersion: string | null;
  // The model's own confidence (ADR-110) -- what the profile screen shows,
  // instead of requesting a recommendation purely to read one band off it.
  confidenceBand: ConfidenceBand | null;
}
// ADR-108: where the profile stands, counted by the server. A repeat round
// (`verify`, ADR-99) is completed but is evidence of nothing, so the two
// counts are never added together on a screen.
export interface ReadinessRounds {
  learningRounds: number;
  verificationRounds: number;
  firstTrainingAt: number;
  nextTrainingAt: number | null;
  // Watched titles a triad may draw from, and how many make the rounds keep
  // learning instead of repeating (three films make exactly one set).
  watchedTitles: number;
  suggestedWatchedTitles: number;
}

export interface ProfileReadiness {
  rounds: ReadinessRounds;
  ordinalModel: CapabilityReadiness;
  // Today the same value as ordinalModel -- one trainer run produces both;
  // see ADR-103 for why they are still separate fields.
  semanticProfile: CapabilityReadiness;
  recommendation: CapabilityReadiness;
  // Always not_ready until a real availability data source exists (AVL-01).
  availability: CapabilityReadiness;
}

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
  // ADR-99: 'verify' re-asks a set already answered (no unseen set was
  // left); it is still a real round to rank, just not new evidence. The
  // product does not need to announce this at the moment it happens.
  purpose: 'learn' | 'verify';
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

// Watchability as its own axis (blueprint §6, §11.3; AVL-01). 'unknown' is
// what the API sends today and what the screen must render honestly -- a
// missing fact, never "not available" and never a zero.
export type AvailabilityState = 'unknown' | 'available' | 'unavailable';

// What a client reports back about a recommendation it showed (ADR-110).
// `watched` is not here: a watch is a watch event, and the outcome row is
// written from it server-side.
export type OutcomeType = 'clicked' | 'saved' | 'dismissed_not_relevant' | 'opened_provider';

export interface Recommendation {
  // The `recommendations` row this item is (ADR-110). Every outcome names
  // it, so the loop closes on the recommendation actually made rather than
  // on the most recent one for the same title.
  recommendationId: string;
  title: Title;
  personalFitScore: number;
  publicQualityScore: number | null;
  watchabilityScore: number | null;
  availability: AvailabilityState;
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
let refreshToken: string | null = null;
// Told the new pair after a silent renewal, so the session provider persists it.
let onTokensRefreshed: ((tokens: { access: string; refresh: string }) => void) | null = null;

// Fired once per rejected token so the session provider can sign out.
export const UNAUTHORIZED_EVENT = 'reel:unauthorized';

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
}

export function getRefreshToken() {
  return refreshToken;
}

export function setTokenRefreshListener(listener: ((tokens: { access: string; refresh: string }) => void) | null) {
  onTokensRefreshed = listener;
}

// One renewal for every concurrent 401 (F8): rotation revokes the presented
// token, so two parallel refreshes would read as reuse and close the family.
let refreshing: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const presented = refreshToken;
      if (!presented) return false;
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: presented }),
        });
        if (!response.ok) return false;
        const data = (await response.json()) as RefreshResponse;
        authToken = data.access_token;
        refreshToken = data.refresh_token;
        onTokensRefreshed?.({ access: data.access_token, refresh: data.refresh_token });
        return true;
      } catch {
        return false;
      }
    })();
    refreshing.finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// `quiet`: a 401 neither renews nor signs out -- for the logout call itself,
// which may run with a token already rejected.
type RequestFlags = { quiet?: boolean; retried?: boolean };

async function request<T>(path: string, options: RequestInit = {}, flags: RequestFlags = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    if (response.status === 401 && authToken && !flags.quiet && typeof window !== 'undefined') {
      // An expired access token renews silently once (F8, ADR-26) and the
      // call is repeated with the new pair. Only when renewal fails too is
      // the token really rejected: then the session provider signs out
      // (M4) so the door appears instead of every screen failing one by one.
      if (!flags.retried && refreshToken && (await refreshOnce())) {
        return request<T>(path, options, { ...flags, retried: true });
      }
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const body = await response.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message || response.statusText;
    throw new ApiError(message, response.status, typeof body === 'object' && body !== null ? body : {});
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

// One row of the fingerprint review queue (docs/API.md `admin/content-features`),
// shared between the list and the review response's `feature`/`correction`
// (ADMIN-W1): a correction is a new row, not an edit, so both carry this shape.
export interface AdminContentFeature {
  id: string;
  titleId: string;
  featureKey: string;
  // NULL means unknown, never 0 (BP §11.3) -- a fix from ADMIN-W3: this was
  // wrongly typed non-nullable through W1/W2, which would have thrown on
  // .toFixed() the first time a real null reached the UI.
  value: number | null;
  extractorVersion: string;
  reviewStatus: string;
  supersededBy?: string | null;
  title: { id: string; internalId: string; titleEn: string; titleAr: string } | null;
}

export const api = {
  // A name is optional at the door since 2026-09-05: it appears on no screen
  // but the profile's account card and enters no model.
  register: (data: { email: string; password: string; firstName?: string; lastName?: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  // Revokes the refresh token (or, with `all`, every live one); the access
  // token stays valid until it expires (API.md §1). Quiet: never re-enters
  // the sign-out path it is part of.
  logout: (data: { refresh_token?: string; all?: boolean }) =>
    request<{ revoked: number }>('/auth/logout', { method: 'POST', body: JSON.stringify(data) }, { quiet: true }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  // Password reset (ADR-85). The request answers 202 for any address (no
  // membership oracle), so the door shows one neutral message; confirm
  // spends the single-use token from the emailed link and revokes every
  // live session of that account.
  requestPasswordReset: (email: string) =>
    request<{ accepted: boolean }>('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }),

  confirmPasswordReset: (token: string, password: string) =>
    request<{ reset: boolean }>('/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) }),

  // Account settings (owner-approved design 2026-09-06). Distinct from
  // password-reset above: this one is used while signed in and requires the
  // current password instead of a mailed token; the caller's own
  // `refresh_token` (when passed) survives the sweep that ends every other
  // session.
  changePassword: (data: { currentPassword: string; newPassword: string; refresh_token?: string }) =>
    request<{ changed: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify(data) }),

  // The confirmation link goes to `newEmail`, never the account's current
  // address; nothing changes until that link is opened.
  requestEmailChange: (data: { newEmail: string; currentPassword: string }) =>
    request<{ accepted: boolean }>('/auth/email-change/request', { method: 'POST', body: JSON.stringify(data) }),

  confirmEmailChange: (token: string) =>
    request<{ email: string }>('/auth/email-change/confirm', { method: 'POST', body: JSON.stringify({ token }) }),

  getProfiles: () => request<Profile[]>('/profiles'),

  createProfile: (data: { name: string; preferredLanguage?: PreferredLanguage }) =>
    request<Profile>('/profiles', { method: 'POST', body: JSON.stringify(data) }),

  updateProfile: (
    profileId: string,
    data: { name?: string; preferredLanguage?: PreferredLanguage; preferredAppearance?: PreferredAppearance | null; market?: string; platforms?: string[] },
  ) =>
    request<Profile>(`/profiles/${profileId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Cascades every event, mark and model snapshot of that profile (and only
  // that profile); the account stays.
  deleteProfile: (profileId: string) => request<void>(`/profiles/${profileId}`, { method: 'DELETE' }),

  getCompletedTriads: (profileId: string) => request<Triad[]>(`/profiles/${profileId}/triads`),

  listTitles: (query: string, page = 1, limit = 20, filters?: { genre?: string | null; year?: number | null }) => {
    const params = new URLSearchParams({ query, page: String(page), limit: String(limit) });
    if (filters?.genre) params.set('genre', filters.genre);
    if (filters?.year) params.set('year', String(filters.year));
    return request<PaginatedTitles>(`/titles?${params}`);
  },

  getTitle: (titleId: string) => request<Title>(`/titles/${titleId}`),

  // A genre-diverse, deterministic sample for a user with no marks yet
  // (blueprint §4.2); no taste input is involved.
  getStarterTitles: (limit = 12) => request<Title[]>(`/titles/starter?limit=${limit}`),

  // No `rating` here: the only explicit preference signal is a triad ranking (blueprint §2.4 #2).
  // `notes` omitted = left alone; `null` = cleared (PATCH semantics). Notes are
  // the user's private diary and never enter the model. `watchedOn` (ADR-104):
  // a plain 'YYYY-MM-DD', omitted = an already-set day is left alone too --
  // pass lib/format.ts's todayLocal() for "right now", or the diary's chosen date.
  setTitleState: (profileId: string, titleId: string, data: { state: TitleState; watchedOn?: string; notes?: string | null }) =>
    request<UserTitleState>(`/profiles/${profileId}/titles/${titleId}/state`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getWatchedTitles: (profileId: string) => request<UserTitleState[]>(`/profiles/${profileId}/watched-titles`),

  getWatchlist: (profileId: string) => request<UserTitleState[]>(`/profiles/${profileId}/watchlist`),

  // 409 until a model snapshot exists, like recommendations.
  getLibraryRanking: (profileId: string) => request<LibraryRankingItem[]>(`/profiles/${profileId}/library/ranking`),

  // ADR-80: 200 with a state discriminator instead of 400/409.
  getCurrentTriad: (profileId: string) =>
    request<(Triad & { state: 'ready' }) | { state: 'need_more_watched'; needed: number; message: string }>(
      `/profiles/${profileId}/triads/current`,
    ),

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

  // ADR-80: 200 with a state discriminator instead of 409. `needed` is the
  // number of ranking rounds still missing before the first training run;
  // once it is 0, `training` says what became of those rounds, so the
  // screen never shows "still learning" over a failure it cannot see.
  getRecommendations: (profileId: string, limit = 10) =>
    request<
      | { state: 'ready'; items: Recommendation[] }
      | { state: 'pending'; needed: number; training: TrainingSummary }
      | { state: 'paused' }
    >(`/profiles/${profileId}/recommendations?limit=${limit}`),

  // ADR-110: the items that actually reached the screen. Never blocks a
  // render -- a lost impression is a lost measurement, not a lost feature.
  recordImpressions: (profileId: string, recommendationIds: string[]) =>
    request<{ recorded: number }>(`/profiles/${profileId}/recommendations/impressions`, {
      method: 'POST',
      body: JSON.stringify({ recommendationIds }),
    }),

  // One reported outcome for one recommendation (ADR-67/110), append-only.
  recordOutcome: (recommendationId: string, type: OutcomeType) =>
    request<{ id: string }>(`/recommendations/${recommendationId}/outcome`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),

  // The watch itself (BP §4.5): marks the title watched *and*, when the
  // watch followed a recommendation, links the outcome row that closes the
  // loop -- which PATCH .../state alone never did.
  recordWatchEvent: (
    profileId: string,
    data: { titleId: string; watchedOn?: string; recommendationId?: string; source?: 'in_app' | 'import' | 'manual' },
  ) =>
    request<{ id: string; recommendationId: string | null }>(`/profiles/${profileId}/watch-events`, {
      method: 'POST',
      body: JSON.stringify({ source: 'in_app', ...data }),
    }),

  getTrainingStatus: (profileId: string) =>
    request<{
      state: TrainingState;
      job: { id: string; status: string; errorKind: TrainingErrorKind; error: string | null } | null;
      completedTriads: number;
      nextTrainingAt: number | null;
      latestSnapshot: { modelVersion: string; trainingTriadCount: number; createdAt: string } | null;
    }>(`/profiles/${profileId}/training`),

  // ADR-103/114: four capabilities with system-owned derived work and only
  // genuine user decisions in `action`. No first-party training command.
  getReadiness: (profileId: string) => request<ProfileReadiness>(`/profiles/${profileId}/readiness`),

  listPrivacyRequests: () =>
    request<{ id: string; type: string; status: string; requestedAt: string; executeAfter: string | null; completedAt: string | null }[]>(
      '/privacy/requests',
    ),

  exportData: (password: string) =>
    request<Record<string, unknown>>('/privacy/export', { method: 'POST', body: JSON.stringify({ password }) }),

  requestDelete: (password: string) =>
    request<{ id: string; type: string; status: string; requestedAt: string; executeAfter: string | null }>('/privacy/delete', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  cancelDelete: (requestId: string) =>
    request<{ id: string; status: string }>(`/privacy/delete/${requestId}/cancel`, { method: 'POST' }),

  // Pause all profiles (no new ranking rounds, no recommendations). A paused
  // profile's recommendations endpoint returns { state:'paused' } (ADR-80).
  pauseAll: () => request<{ paused: number; pausedAt: string }>('/privacy/pause', { method: 'POST' }),
  resumeAll: () => request<{ resumed: number }>('/privacy/resume', { method: 'POST' }),

  getConsents: () => request<Consent[]>('/consents'),

  // User-scoped, not profile-scoped (blueprint gap 7): terms_privacy is
  // asked at registration, before any profile exists (PRIVACY.md §3).
  // Upserts per (purpose, version); a repeat call with the same values is a
  // safe no-op.
  updateConsents: (consents: { purpose: ConsentPurpose; version: string; granted: boolean }[]) =>
    request<Consent[]>('/consents', { method: 'PUT', body: JSON.stringify({ consents }) }),

  // ── Admin (role:admin required; 403 { reason:'admin_required' } otherwise) ──

  // ADMIN-W1 (ADR-117): the access-boundary probe -- 401/403 distinguish
  // "not signed in" from "signed in, not admin" before any tab mounts.
  // `capabilities` are UI hints only; the server enforces access either way.
  adminGetContext: (signal?: AbortSignal) =>
    request<{ user: { id: string; email: string; role: string }; capabilities: string[] }>('/admin/context', { signal }),

  adminGetTitles: (params: { query?: string; missing?: 'fingerprint' | 'v2' | 'license'; page?: number; limit?: number; signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    if (params.query) qs.set('query', params.query);
    if (params.missing) qs.set('missing', params.missing);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{
      items: { id: string; internalId: string; titleEn: string; titleAr: string; releaseYear: number | null; hasFingerprint: boolean; hasV2: boolean; licenseStatus: string; sourceRecords: number; unreviewedFeatures: number }[];
      total: number; page: number; limit: number; totalPages: number;
    }>(`/admin/titles?${qs}`, { signal: params.signal });
  },

  // ── ADMIN-W4: catalog/rights writes (plan §18 W4) ───────────────────────────

  adminUpdateTitle: (
    titleId: string,
    dto: { titleEn?: string; titleAr?: string; description?: string; releaseYear?: number; genres?: string[]; originalLanguage?: string; externalIds?: { imdb?: string; tmdb?: string; wikidata?: string } },
  ) => request<AdminTitleRecord>(`/admin/titles/${titleId}`, { method: 'PATCH', body: JSON.stringify(dto) }),

  adminAddSourceRecord: (
    titleId: string,
    dto: {
      fieldName: string; source: string; value?: string; license?: string; licenseStatus: string;
      allowsStorage?: boolean; allowsDerivation?: boolean; allowsTraining?: boolean; attributionRequired?: boolean;
      fallbackPlan?: string; reviewStatus?: string;
    },
  ) => request<AdminSourceRecord>(`/admin/titles/${titleId}/source-records`, { method: 'POST', body: JSON.stringify(dto) }),

  // A 409 here means the record was already superseded by a later edit --
  // the caller should re-fetch provenance and edit the current row instead.
  adminUpdateSourceRecord: (
    recordId: string,
    dto: {
      licenseStatus?: string; reviewStatus?: string; license?: string;
      allowsStorage?: boolean; allowsDerivation?: boolean; allowsTraining?: boolean; attributionRequired?: boolean;
      fallbackPlan?: string;
    },
  ) => request<AdminSourceRecord>(`/admin/source-records/${recordId}`, { method: 'PATCH', body: JSON.stringify(dto) }),

  adminGetContentFeatures: (params: { reviewStatus?: string; titleId?: string; featureKey?: string; page?: number; limit?: number; signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    if (params.reviewStatus) qs.set('reviewStatus', params.reviewStatus);
    if (params.titleId) qs.set('titleId', params.titleId);
    if (params.featureKey) qs.set('featureKey', params.featureKey);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{
      items: AdminContentFeature[];
      total: number; page: number; totalPages: number;
    }>(`/admin/content-features?${qs}`, { signal: params.signal });
  },

  // ADMIN-W1 (ADR-117 W1 contract defect): the real response nests both rows
  // -- `correction` is null unless `correctedValue` produced a new one -- it
  // is not the flat `{id, reviewStatus}` this used to (wrongly) declare.
  // ADMIN-W4 (ADM-P0-02): `republish` is present only alongside a
  // correction -- non-null means the change was folded into
  // `titles.fingerprint` in the same request; `changes` is empty when the
  // corrected value already matched what was published.
  adminReviewFeature: (featureId: string, data: { reviewStatus: string; correctedValue?: number; note?: string }) =>
    request<{
      feature: AdminContentFeature; correction: AdminContentFeature | null;
      republish: { changes: { featureKey: string; before: number | null; after: number }[] } | null;
    }>(`/admin/content-features/${featureId}/review`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  adminGetModels: () =>
    request<{
      versions: { version: string; rankerType: string; active: boolean; fingerprintSchemaVersion: string; createdAt: string; stats: { snapshotCount: number; profileCount: number } | null }[];
      unregistered: { modelVersion: string; snapshotCount: number; profileCount: number }[];
    }>('/admin/models'),

  // A 409 (reason 'exists') means the version string is already registered.
  adminRegisterModel: (dto: { version: string; rankerType: string; fingerprintSchemaVersion: string; codeRef?: string }) =>
    request<AdminModelVersion>('/admin/models', { method: 'POST', body: JSON.stringify(dto) }),

  // Setting `active: true` deactivates every other version atomically on the
  // server -- exactly one active version at a time, never client-computed.
  adminUpdateModel: (version: string, dto: { active?: boolean }) =>
    request<AdminModelVersion>(`/admin/models/${encodeURIComponent(version)}`, { method: 'PATCH', body: JSON.stringify(dto) }),

  // ADR-100: the durable training queue, mirroring the mail outbox's admin shape.
  adminGetTrainingJobs: (limit = 20) =>
    request<{
      counts: { queued: number; running: number; succeeded: number; failed: number };
      recent: {
        id: string; profileId: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
        attempts: number; errorKind: 'invalid' | 'error' | null; lastError: string | null;
        nextAttemptAt: string; startedAt: string | null; finishedAt: string | null; createdAt: string; updatedAt: string;
      }[];
    }>(`/admin/training-jobs?limit=${limit}`),

  // ADR-100: can training plausibly succeed right now -- database, catalog
  // size, fingerprint coverage, model-service reachability.
  adminGetReadiness: () =>
    request<{
      database: { ok: boolean };
      catalog: { titles: number; threshold: number; ok: boolean };
      fingerprintCoverage: { published: number; total: number; percent: number; ok: boolean };
      modelService: { configured: boolean; reachable: boolean; ok: boolean };
    }>('/admin/readiness'),

  adminGetUsers: (params: { query?: string; page?: number; limit?: number; signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    if (params.query) qs.set('query', params.query);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: AdminUserRow[]; total: number; page: number; limit: number; totalPages: number }>(`/admin/users?${qs}`, { signal: params.signal });
  },

  // A 403 with reason 'self_change' means the acting admin targeted their
  // own account; reason 'last_admin' means they targeted the only other
  // active admin -- both are refused server-side, not just hidden in the UI.
  adminUpdateUser: (userId: string, dto: { active?: boolean; role?: 'user' | 'admin'; reason?: string }) =>
    request<AdminUserRow>(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(dto) }),

  adminGetPrivacyRequests: (params: { type?: string; status?: string; page?: number; limit?: number; signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.status) qs.set('status', params.status);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{
      items: { id: string; type: string; status: string; requestedAt: string; executeAfter: string | null; completedAt: string | null }[];
      total: number; page: number; totalPages: number;
    }>(`/admin/privacy-requests?${qs}`, { signal: params.signal });
  },

  // ── ADMIN-W3: completing the monitoring read surface (plan §18 W3) ──────────

  // The single-title detail: full source row plus the same summary shape the
  // catalog list uses, so a detail screen can share its badges/labels.
  adminGetTitleDetail: (titleId: string, signal?: AbortSignal) =>
    request<AdminTitleDetail>(`/admin/titles/${titleId}`, { signal }),

  // Rights history and per-extractor feature grouping for one title (W0 case
  // B1): current and superseded rows, never edited in place.
  adminGetProvenance: (titleId: string, signal?: AbortSignal) =>
    request<AdminProvenance>(`/admin/titles/${titleId}/provenance`, { signal }),

  // A random spot-check sample of analyzed rows (W0 case B2) -- distinct from
  // the paginated review queue and from F4's write: retrieval alone never
  // marks anything reviewed.
  adminSampleContentFeatures: (params: { size?: number; extractorVersion?: string; signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    if (params.size) qs.set('size', String(params.size));
    if (params.extractorVersion) qs.set('extractorVersion', params.extractorVersion);
    return request<{ items: AdminContentFeature[]; size: number }>(`/admin/content-features/sample?${qs}`, { signal: params.signal });
  },

  // Arm assignment counts per experiment (W0 case B3); no attribution claims
  // or experiment controls before W7.
  adminGetExperiments: (signal?: AbortSignal) =>
    request<{ id: string; hypothesis: string; status: string; startedAt: string | null; endedAt: string | null; arms: Record<string, number> }[]>(
      '/admin/experiments',
      { signal },
    ),

  // The newest completed ranking rounds, pseudonymous profile ids only (W0
  // case B3).
  adminGetLatestTriads: (limit = 50, signal?: AbortSignal) =>
    request<
      { id: string; profileId: string; titleIds: string[]; ranking: string[] | null; modelVersion: string | null; shownAt: string | null; answeredAt: string | null; createdAt: string }[]
    >(`/admin/triads/latest?limit=${limit}`, { signal }),

  // Who did what, to what, and whether it succeeded (W0 case B5) -- read-only,
  // the audit trail itself is never editable from here.
  adminGetAuditLog: (params: { actorUserId?: string; action?: string; resource?: string; resourceId?: string; page?: number; limit?: number; signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    if (params.actorUserId) qs.set('actorUserId', params.actorUserId);
    if (params.action) qs.set('action', params.action);
    if (params.resource) qs.set('resource', params.resource);
    if (params.resourceId) qs.set('resourceId', params.resourceId);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{
      items: { id: string; actorUserId: string | null; actorRole: string | null; action: string; resource: string; resourceId: string | null; status: string; reason: string | null; createdAt: string }[];
      total: number; page: number; totalPages: number;
    }>(`/admin/audit-log?${qs}`, { signal: params.signal });
  },

  // Outgoing mail counts and recent rows (ADR-97, W0 case B6) -- never an
  // address or a body.
  adminGetMailOutbox: (signal?: AbortSignal) =>
    request<{
      counts: { pending: number; delivered: number; dead: number };
      recent: { id: string; kind: string; status: 'pending' | 'delivered' | 'dead'; attempts: number; nextAttemptAt: string; lastError: string | null; deliveredAt: string | null; createdAt: string }[];
    }>('/admin/mail-outbox', { signal }),

  // The metrics board (BP §18.1, W0 case B6): read-only SQL over event rows.
  // `days` is used only when `from`/`to` are both absent.
  adminGetMetrics: (params: { days?: number; from?: string; to?: string; excludeDomains?: string[]; signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    if (params.days) qs.set('days', String(params.days));
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.excludeDomains?.length) qs.set('excludeDomains', params.excludeDomains.join(','));
    return request<AdminMetricsReport>(`/admin/metrics?${qs}`, { signal: params.signal });
  },
};

// The raw row PATCH /admin/titles/:id returns -- no `summary` (that is
// AdminTitleDetail's own decoration, computed only by the GET route).
export interface AdminTitleRecord {
  id: string; internalId: string; titleEn: string; titleAr: string;
  description: string | null; releaseYear: number | null; genres: string[] | null;
  originalLanguage: string | null;
  externalIds: { imdb?: string; tmdb?: string; wikidata?: string } | null;
  createdAt: string; updatedAt: string;
}

export interface AdminModelVersion {
  version: string; rankerType: string; fingerprintSchemaVersion: string;
  codeRef: string | null; active: boolean; createdAt: string;
}

export interface AdminUserRow {
  id: string; email: string; firstName: string | null; lastName: string | null;
  role: 'user' | 'admin'; active: boolean; profiles: number; createdAt: string;
}

export interface AdminTitleDetail {
  id: string; internalId: string; titleEn: string; titleAr: string;
  description: string | null; releaseYear: number | null; genres: string[] | null;
  originalLanguage: string | null;
  externalIds: { imdb?: string; tmdb?: string; wikidata?: string } | null;
  createdAt: string; updatedAt: string;
  summary: {
    hasFingerprint: boolean; hasV2: boolean; licenseStatus: string;
    sourceRecords: number; unreviewedFeatures: number;
  };
}

export interface AdminSourceRecord {
  id: string; titleId: string; fieldName: string; value: string | null; source: string;
  license: string | null; licenseStatus: string;
  allowsStorage: boolean | null; allowsDerivation: boolean | null; allowsTraining: boolean | null;
  attributionRequired: boolean | null; fallbackPlan: string | null; reviewStatus: string | null;
  supersededBy: string | null; createdAt: string;
}

export interface AdminProvenance {
  titleId: string;
  sourceRecords: AdminSourceRecord[];
  features: AdminContentFeature[];
  byExtractor: Record<string, { rows: number; unreviewed: number; superseded: number }>;
  licenseStatus: string;
}

export interface AdminMetricsReport {
  window: { from: string; to: string; days: number; excludeDomains: string[] };
  accounts: { usersTotal: number; usersActive: number; registeredInWindow: number; profilesTotal: number };
  funnel: { cohort: string; size: number; steps: { step: string; count: number; rate: number | null }[] };
  triads: {
    completed: number; skipped: number; active: number; replacements: number; replacementRate: number | null;
    answerSeconds: { samples: number; median: number | null; p90: number | null; mean: number | null };
    byPolicy: Record<string, number>;
  };
  recommendations: {
    shown: number; requests: number; profiles: number;
    byTrack: Record<string, number>; byBand: Record<string, number>;
    outcomes: { clicked: number; saved: number; opened_provider: number; dismissed_not_relevant: number; watched: number; ranked_later: number };
    rates: { clickThrough: number | null; watched: number | null; rankedLater: number | null; dismissed: number | null };
    hoursToWatch: { samples: number; median: number | null };
  };
  model: {
    snapshotsInWindow: number; profilesWithSnapshot: number;
    byModelVersion: Record<string, number>; latestSnapshotByEvidence: Record<string, number>;
    meanHeldOutPairwiseAccuracy: number | null;
  };
  catalog: { titles: number; withFingerprint: number; withV2: number; withKnownLicense: number; unreviewedFeatures: number };
  privacy: { requestsByType: Record<string, number>; pendingDeletes: number; auditRowsInWindow: number };
  daily: { day: string; registrations: number; triadsCompleted: number; recommendationsShown: number; watchedOutcomes: number }[];
}
