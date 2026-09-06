import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TitlePoster } from '../../entities/title-poster.entity';
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
  // The only dependency this service has: `title_posters` (ADR-120), for the
  // batched multi-poster read below. Never the rights registry -- `forTitles`
  // still needs nothing but the path already on the title, so it and
  // `attach`'s single-poster fields stay untouched by this addition.
  constructor(
    @InjectRepository(TitlePoster)
    private readonly titlePostersRepository: Repository<TitlePoster>,
  ) {}

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

  // POSTERS-MULTI P3 (ADR-120): every poster `title_posters` has for a batch
  // of titles, one query (`titleId IN (...)`, covered by the table's own
  // `UQ_title_posters_titleId_posterPath` -- no second index needed), never
  // one query per title. Grouped by titleId, each list ordered by
  // `sortOrder` ascending (index 0 is always the image `titles.posterPath`
  // also carries, per P2's backfill). A title with no `title_posters` row is
  // simply absent from the map -- the caller falls back to `[]`, same
  // convention as `forTitles`.
  async forTitlesMulti(titleIds: string[]): Promise<Map<string, Poster[]>> {
    const result = new Map<string, Poster[]>();
    if (titleIds.length === 0) {
      return result;
    }
    const rows = await this.titlePostersRepository.find({
      where: { titleId: In(titleIds) },
      order: { titleId: 'ASC', sortOrder: 'ASC' },
    });
    for (const row of rows) {
      const poster: Poster = {
        posterUrl: `${POSTER_BASE_URL}${row.posterPath}`,
        posterSource: { name: POSTER_SOURCE_NAME, attribution: ATTRIBUTION_BY_SOURCE[POSTER_SOURCE_NAME] ?? null },
      };
      const list = result.get(row.titleId);
      if (list) {
        list.push(poster);
      } else {
        result.set(row.titleId, [poster]);
      }
    }
    return result;
  }

  // Attach to whatever shape already carries the title columns; a title
  // without a poster gets explicit nulls, never a broken URL. `posters` is
  // additive (P3): `posterUrl`/`posterSource` keep their exact prior meaning
  // and are never derived from it, so an existing reader is unaffected.
  async attach<T extends { id: string; posterPath?: string | null }>(
    titles: T[],
  ): Promise<(T & { posterUrl: string | null; posterSource: PosterSource | null; posters: Poster[] })[]> {
    const [singles, multi] = await Promise.all([this.forTitles(titles), this.forTitlesMulti(titles.map((title) => title.id))]);
    return titles.map((title) => {
      const poster = singles.get(title.id);
      return {
        ...title,
        posterUrl: poster?.posterUrl ?? null,
        posterSource: poster?.posterSource ?? null,
        posters: multi.get(title.id) ?? [],
      };
    });
  }
}
