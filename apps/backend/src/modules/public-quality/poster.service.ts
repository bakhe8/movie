import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { ATTRIBUTION_BY_SOURCE, DISPLAYABLE_LICENSE_STATUSES } from './public-quality.constants';

// Owner decision 2026-09-04 (board B4): a poster on every surface. The
// served size -- `w342` is what the card and the work page both render at;
// a bigger one costs bandwidth for no visible gain on a phone.
export const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
export const POSTER_FIELD = 'posterPath';

export interface PosterSource {
  name: string;
  attribution: string | null;
}

export interface Poster {
  posterUrl: string;
  posterSource: PosterSource;
}

// Composes the URL a client renders, but only for titles whose image has a
// rights-registry row this stage may display (DATA_LICENSING.md §0, ADR-82).
// A title with a path but no displayable row is absent from the map: the
// caller shows the hollow slot, never an unlicensed image.
@Injectable()
export class PosterService {
  constructor(
    @InjectRepository(SourceRecord)
    private readonly sourceRecordsRepository: Repository<SourceRecord>,
  ) {}

  async forTitles(titles: { id: string; posterPath?: string | null }[]): Promise<Map<string, Poster>> {
    const result = new Map<string, Poster>();
    const withPath = titles.filter((title) => typeof title.posterPath === 'string' && title.posterPath.length > 0);
    if (withPath.length === 0) {
      return result;
    }

    const rows = await this.sourceRecordsRepository.find({
      where: { titleId: In(withPath.map((title) => title.id)), fieldName: POSTER_FIELD },
      order: { retrievedAt: 'DESC' },
    });
    const displayable = new Map<string, SourceRecord>();
    for (const row of rows) {
      if (!row.titleId || displayable.has(row.titleId)) {
        continue;
      }
      if ((DISPLAYABLE_LICENSE_STATUSES as readonly string[]).includes(row.licenseStatus)) {
        displayable.set(row.titleId, row);
      }
    }

    for (const title of withPath) {
      const record = displayable.get(title.id);
      if (!record) {
        continue;
      }
      result.set(title.id, {
        posterUrl: `${POSTER_BASE_URL}${title.posterPath as string}`,
        posterSource: { name: record.source, attribution: ATTRIBUTION_BY_SOURCE[record.source] ?? null },
      });
    }
    return result;
  }

  // Attach to whatever shape already carries the title columns; a title
  // without a displayable poster gets explicit nulls, never a broken URL.
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
