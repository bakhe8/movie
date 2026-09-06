/**
 * Pure building blocks for PUB-B1's poster backfill (ADR-118): closes the
 * one gap the public-v1 shadow report found (POSTER_MISSING, 87 titles).
 * The rights-registry row shape is `load-catalog-rights.ts`'s own
 * `tmdbPosterRow` -- reused now that it is committed and stable, not
 * duplicated (it had uncommitted edits in flight from another session
 * during PUB-B1's first pass, which is why this started as a standalone
 * copy; POSTERS-P2 landed in `a51ba4a`, so the copy is gone).
 */
import { tmdbPosterRow } from './load-catalog-rights';

export const EXTRACTOR_VERSION = 'pub-b1-poster-backfill-v1';

export interface TmdbMovieResponse {
  poster_path?: string | null;
  success?: boolean;
  status_message?: string;
}

/**
 * TMDB's own relative path from `GET /movie/{id}`, or `null` when TMDB
 * genuinely has none for that id -- never invented. Only called with a 200
 * body; a 404 or any other status is handled by the caller as its own
 * outcome, not passed here.
 */
export function parseTmdbPosterPath(body: string): string | null {
  let data: TmdbMovieResponse;
  try {
    data = JSON.parse(body) as TmdbMovieResponse;
  } catch {
    return null;
  }
  return typeof data.poster_path === 'string' && data.poster_path.length > 0 ? data.poster_path : null;
}

export const tmdbPosterSourceRecordRow = tmdbPosterRow;
