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
