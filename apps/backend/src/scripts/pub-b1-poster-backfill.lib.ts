/**
 * Pure building blocks for PUB-B1's poster backfill (ADR-118): closes the
 * one gap the public-v1 shadow report found (POSTER_MISSING, 87 titles) by
 * the same TMDB call and rights-registry row shape the catalog already uses
 * for posters (`fetch-tmdb-posters.ts`, `load-catalog-rights.ts`) --
 * reimplemented standalone here rather than imported, because both of those
 * files had uncommitted edits in flight from another session when this ran.
 */

export const TMDB_ATTRIBUTION =
  'TMDB Terms of Use: image non-commercial without a paid licence; attribution required — "This product uses the TMDB API but is not endorsed or certified by TMDB."';

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

export interface SourceRecordRowSpec {
  fieldName: string;
  value: string;
  source: string;
  license: string;
  licenseStatus: 'non_commercial_only';
  allowsStorage: boolean;
  allowsDerivation: boolean;
  allowsTraining: boolean;
  attributionRequired: boolean;
  fallbackPlan: string;
}

/** Same shape and terms as `load-catalog-rights.ts`'s `tmdbPosterRow` (BP §11.3). */
export function tmdbPosterSourceRecordRow(posterPath: string): SourceRecordRowSpec {
  return {
    fieldName: 'posterPath',
    value: `https://image.tmdb.org/t/p/original${posterPath}`,
    source: 'tmdb',
    license: TMDB_ATTRIBUTION,
    licenseStatus: 'non_commercial_only',
    allowsStorage: true,
    allowsDerivation: false,
    allowsTraining: false,
    attributionRequired: true,
    fallbackPlan: 'omit the poster (empty slot) until a licensed image is available',
  };
}
