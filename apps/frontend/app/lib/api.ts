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
  // Title ids in ranked order, best-liked first -- not indices into
  // titleIds (ADR-15).
  ranking: string[] | null;
  shownAt: string | null;
  answeredAt: string | null;
  modelVersion: string | null;
  status: TriadStatus;
  createdAt: string;
}

export type ConfidenceBand = 'initial' | 'likely' | 'strong' | 'inconclusive';
export type RecommendationTrack = 'safe' | 'discovery' | 'outside_usual';

// Personal Fit, Public Quality, and Watchability stay three separate values, never
// merged into one score, and confidence is a verbal band rather than a raw
// percentage until calibrated (blueprint §4.4, §7.2, §9.3).
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
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;

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
    throw new ApiError(message, response.status);
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

  listTitles: (query: string, page = 1, limit = 20) =>
    request<PaginatedTitles>(
      `/titles?${new URLSearchParams({ query, page: String(page), limit: String(limit) })}`,
    ),

  getTitle: (titleId: string) => request<Title>(`/titles/${titleId}`),

  // No `rating` here: the only explicit preference signal is a triad ranking (blueprint §2.4 #2).
  setTitleState: (profileId: string, titleId: string, data: { state: TitleState; watchedAt?: string; notes?: string }) =>
    request<UserTitleState>(`/profiles/${profileId}/titles/${titleId}/state`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getWatchedTitles: (profileId: string) => request<UserTitleState[]>(`/profiles/${profileId}/watched-titles`),

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

  getRecommendations: (profileId: string, limit = 10) =>
    request<Recommendation[]>(`/profiles/${profileId}/recommendations?limit=${limit}`),
};
