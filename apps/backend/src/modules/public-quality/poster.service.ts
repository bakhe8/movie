import { Injectable } from '@nestjs/common';
import { ATTRIBUTION_BY_SOURCE } from './public-quality.constants';

// Owner decision 2026-09-04 (board B4): a poster on every surface. The
// served size -- `w342` is what the card and the work page both render at;
// a bigger one costs bandwidth for no visible gain on a phone.
export const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
export const POSTER_FIELD = 'posterPath';

// The one image source today: `titles.posterPath` is TMDB's path by
// construction (ADR-82), so the credit TMDB's terms require travels with
// every poster, whatever the rights registry says about the row.
export const POSTER_SOURCE_NAME = 'tmdb';

export interface PosterSource {
  name: string;
  attribution: string | null;
}

export interface Poster {
  posterUrl: string;
  posterSource: PosterSource;
}

// Composes the URL a client renders for every title that has a stored path.
// Owner decision 2026-09-05 (board 13): licensing is not a display gate at
// this stage -- DATA_LICENSING.md §0 already reads a missing or `unknown`
// rights row as hygiene debt, not a block, while the service earns nothing.
// ADR-82's registry gate is therefore gone from this read path; the
// `source_records` rows stay, per value, so the switch to a display gate at
// the revenue decision is a data change, not a rebuild. A title without a
// path is absent from the map and the caller shows the hollow slot.
@Injectable()
export class PosterService {
  async forTitles(titles: { id: string; posterPath?: string | null }[]): Promise<Map<string, Poster>> {
    const result = new Map<string, Poster>();
    for (const title of titles) {
      if (typeof title.posterPath !== 'string' || title.posterPath.length === 0) {
        continue;
      }
      result.set(title.id, {
        posterUrl: `${POSTER_BASE_URL}${title.posterPath}`,
        posterSource: { name: POSTER_SOURCE_NAME, attribution: ATTRIBUTION_BY_SOURCE[POSTER_SOURCE_NAME] ?? null },
      });
    }
    return result;
  }

  // Attach to whatever shape already carries the title columns; a title
  // without a poster gets explicit nulls, never a broken URL.
  async attach<T extends { id: string; posterPath?: string | null }>(
    titles: T[],
  ): Promise<(T & { posterUrl: string | null; posterSource: PosterSource | null })[]> {
    const posters = await this.forTitles(titles);
    return titles.map((title) => {
      const poster = posters.get(title.id);
      return { ...title, posterUrl: poster?.posterUrl ?? null, posterSource: poster?.posterSource ?? null };
    });
  }
}
