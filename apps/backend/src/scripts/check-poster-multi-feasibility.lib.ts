/**
 * Pure building blocks for the P0 TMDB multi-poster feasibility check
 * (board POSTERS-MULTI). Read-only: counts how many posters TMDB's
 * `GET /movie/{id}/images` returns for a title, across every language TMDB
 * has (no `include_image_language` filter — confirmed live that omitting it
 * returns all languages, not just the primary one). Never writes to the
 * catalog fixture; that is P1/P2's job once this gate passes.
 */

export interface FeasibilityEntry {
  internalId: string;
  externalIds?: { tmdb?: string | null } | null;
}

export interface TmdbImagesResponse {
  posters?: unknown[];
  success?: boolean;
  status_message?: string;
}

/** A title is checkable when it has a TMDB id — nothing else disqualifies it. */
export function hasTmdbId(entry: FeasibilityEntry): boolean {
  return Boolean(entry.externalIds?.tmdb);
}

/**
 * Number of TMDB posters for the response body of `GET /movie/{id}/images`,
 * or `null` when the request failed (404: no such id, or a non-200 status) —
 * never a guessed count.
 */
export function parsePosterCount(status: number, body: string): number | null {
  if (status !== 200) {
    return null;
  }
  let data: TmdbImagesResponse;
  try {
    data = JSON.parse(body) as TmdbImagesResponse;
  } catch {
    return null;
  }
  return Array.isArray(data.posters) ? data.posters.length : null;
}

export type CoverageBucket = 'no_tmdb_id' | 'request_failed' | 'zero' | 'one' | 'multi';

/** `multi` (2+ posters) is the bucket that makes the carousel worth building for that title. */
export function bucketFor(count: number | null): CoverageBucket {
  if (count === null) return 'request_failed';
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  return 'multi';
}
