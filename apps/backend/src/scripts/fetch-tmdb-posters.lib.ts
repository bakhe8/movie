/**
 * Pure building blocks for TMDB poster paths (board C-2, archive B4): a
 * relative path TMDB itself returns (e.g. `/abc123.jpg`), never the image
 * bytes, never scraped -- one call to TMDB's official `/movie/{id}` endpoint
 * per title. Composing a display URL and gating it on the current license
 * environment (`PublicTitle.posterUrl`/`posterSource`) is a separate concern
 * (board M1); this only decides what to fetch and what the response means.
 */

export interface PosterEntry {
  internalId: string;
  externalIds?: { tmdb?: string | null } | null;
  /** `undefined`: never checked. `null`: checked, TMDB has none. A string: the path. */
  posterPath?: string | null;
}

export interface TmdbMovieResponse {
  poster_path?: string | null;
  success?: boolean;
  status_message?: string;
}

/** A title is a candidate when it has a TMDB id and (force, or its poster has never been checked). */
export function needsPoster(entry: PosterEntry, force = false): boolean {
  return Boolean(entry.externalIds?.tmdb) && (force || entry.posterPath === undefined);
}

/**
 * TMDB's own path for the response body of `GET /movie/{id}`, or `null` when
 * the request succeeded but TMDB has no poster (never a guess, never a
 * fabricated path). `status` is the HTTP status `cachedGet` returned.
 */
export function parsePosterResponse(status: number, body: string): string | null {
  if (status !== 200) {
    return null; // 404 (no such id) or an API error: no claim made, not an extraction failure
  }
  let data: TmdbMovieResponse;
  try {
    data = JSON.parse(body) as TmdbMovieResponse;
  } catch {
    return null;
  }
  return typeof data.poster_path === 'string' && data.poster_path.length > 0 ? data.poster_path : null;
}

// POSTERS-MULTI P2 (ADR-120): building blocks for backfilling `title_posters`
// from TMDB's `GET /movie/{id}/images` (same endpoint P0's feasibility check
// used). Still pure -- no HTTP, no DB -- so the selection rule is unit
// tested without a network call or a database.

export interface TmdbPosterImage {
  file_path: string;
  vote_average?: number;
}

export interface TmdbImagesResponse {
  posters?: TmdbPosterImage[];
  success?: boolean;
  status_message?: string;
}

// Mirrors `CHK_title_posters_path` (the migration's own guard): TMDB's bare
// path only, never a composed URL. Checked here too so a malformed entry is
// dropped before insert rather than failing the whole batch on the
// constraint.
const VALID_POSTER_PATH = /^\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

export function isValidPosterPath(path: string): boolean {
  return VALID_POSTER_PATH.test(path);
}

/**
 * Every poster TMDB's `/movie/{id}/images` returned, or `null` when the
 * request failed (404: no such id, or a non-200 status) -- never a guessed
 * list.
 */
export function parsePosterImages(status: number, body: string): TmdbPosterImage[] | null {
  if (status !== 200) {
    return null;
  }
  let data: TmdbImagesResponse;
  try {
    data = JSON.parse(body) as TmdbImagesResponse;
  } catch {
    return null;
  }
  return Array.isArray(data.posters) ? data.posters : null;
}

export interface PosterRow {
  posterPath: string;
  sortOrder: number;
}

/**
 * Up to `limit` posters for one title, ordered for `title_posters.sortOrder`.
 * `currentPosterPath` (the title's existing single poster, if any) always
 * leads at 0 -- ADR-120's agreement that the poster a user has already seen
 * never moves when the carousel appears -- and the rest of TMDB's images
 * fill the remaining slots by `vote_average` descending (ties broken by
 * path, for a deterministic order). A path that fails
 * `CHK_title_posters_path` is dropped rather than left to fail the insert.
 */
export function selectPosterRows(currentPosterPath: string | null, images: TmdbPosterImage[], limit: number): PosterRow[] {
  const validImages = images.filter((image) => typeof image.file_path === 'string' && isValidPosterPath(image.file_path));
  const sorted = [...validImages].sort((a, b) => {
    const voteDiff = (b.vote_average ?? 0) - (a.vote_average ?? 0);
    return voteDiff !== 0 ? voteDiff : a.file_path.localeCompare(b.file_path);
  });

  const ordered: string[] = [];
  if (currentPosterPath && isValidPosterPath(currentPosterPath)) {
    ordered.push(currentPosterPath);
  }
  for (const image of sorted) {
    if (!ordered.includes(image.file_path)) {
      ordered.push(image.file_path);
    }
  }

  return ordered.slice(0, Math.max(0, limit)).map((posterPath, sortOrder) => ({ posterPath, sortOrder }));
}
