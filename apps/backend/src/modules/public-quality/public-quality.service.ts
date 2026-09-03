import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PublicQualitySource } from '../../entities/public-quality-source.entity';
import { SourceRecord } from '../../entities/source-record.entity';
import { ATTRIBUTION_BY_SOURCE, DISPLAYABLE_LICENSE_STATUSES } from './public-quality.constants';

// What the API shows for one source of one title. `attribution` is the
// line the source requires (DATA_LICENSING.md §5); the client renders it
// next to the value and never invents one.
export interface PublicQualitySourceView {
  source: string;
  value: number | null;
  scale: string | null;
  votes: number | null;
  capturedAt: string;
  attribution: string | null;
}

// BP §10.3 / API.md §2.3: sources are listed separately and never merged.
// `value`/`votes` at the top level are a convenience for the single-source
// case only; with two or more sources they are null, not an average.
export interface PublicQuality {
  value: number | null;
  votes: number | null;
  sources: PublicQualitySourceView[];
}

@Injectable()
export class PublicQualityService {
  constructor(
    @InjectRepository(PublicQualitySource)
    private readonly publicQualityRepository: Repository<PublicQualitySource>,
    @InjectRepository(SourceRecord)
    private readonly sourceRecordsRepository: Repository<SourceRecord>,
  ) {}

  async forTitle(titleId: string): Promise<PublicQuality | null> {
    const byTitle = await this.forTitles([titleId]);
    return byTitle.get(titleId) ?? null;
  }

  // The latest row per (title, source), restricted to values whose registry
  // row has a known, displayable license status for the current stage
  // (DATA_LICENSING.md §0). A title with no displayable value is absent from
  // the map: the caller shows null, never 0 (BP §11.3).
  async forTitles(titleIds: string[]): Promise<Map<string, PublicQuality>> {
    const result = new Map<string, PublicQuality>();
    if (titleIds.length === 0) {
      return result;
    }

    const rows = await this.publicQualityRepository.find({
      where: { titleId: In(titleIds) },
      order: { capturedAt: 'DESC' },
    });
    if (rows.length === 0) {
      return result;
    }

    const registry = await this.sourceRecordsRepository.find({
      where: { id: In([...new Set(rows.map((row) => row.sourceRecordId))]) },
    });
    const registryById = new Map(registry.map((record) => [record.id, record]));

    // Rows are newest first, so the first (title, source) pair seen wins.
    const seen = new Set<string>();
    const views = new Map<string, PublicQualitySourceView[]>();
    for (const row of rows) {
      const key = `${row.titleId}:${row.source}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const record = registryById.get(row.sourceRecordId);
      if (!record || !(DISPLAYABLE_LICENSE_STATUSES as readonly string[]).includes(record.licenseStatus)) {
        continue;
      }
      const list = views.get(row.titleId) ?? [];
      list.push({
        source: row.source,
        value: row.value,
        scale: row.scale,
        votes: row.votes,
        capturedAt: row.capturedAt.toISOString(),
        attribution: record.attributionRequired ? (ATTRIBUTION_BY_SOURCE[row.source] ?? null) : null,
      });
      views.set(row.titleId, list);
    }

    for (const [titleId, sources] of views) {
      const single = sources.length === 1 ? sources[0] : null;
      result.set(titleId, { value: single?.value ?? null, votes: single?.votes ?? null, sources });
    }
    return result;
  }
}
