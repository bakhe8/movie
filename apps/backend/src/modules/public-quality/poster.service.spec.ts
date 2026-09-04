import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { PosterService } from './poster.service';

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    titleId: 't1',
    fieldName: 'posterPath',
    source: 'tmdb',
    licenseStatus: 'non_commercial_only',
    retrievedAt: new Date('2026-09-04'),
    ...overrides,
  } as SourceRecord;
}

describe('PosterService', () => {
  let sourceRecords: { find: ReturnType<typeof vi.fn> };
  let service: PosterService;

  beforeEach(() => {
    sourceRecords = { find: vi.fn().mockResolvedValue([record()]) };
    service = new PosterService(sourceRecords as unknown as Repository<SourceRecord>);
  });

  it('composes the served URL from the stored path and credits the source', async () => {
    const posters = await service.forTitles([{ id: 't1', posterPath: '/abc.jpg' }]);

    expect(posters.get('t1')).toEqual({
      posterUrl: 'https://image.tmdb.org/t/p/w342/abc.jpg',
      posterSource: { name: 'tmdb', attribution: expect.stringContaining('TMDB') },
    });
  });

  // DATA_LICENSING.md §0 / BP App. B: nothing is shown without a known,
  // displayable licence status -- an image is exactly the case that rule is for.
  it('withholds a poster whose rights row is not displayable in this environment', async () => {
    sourceRecords.find.mockResolvedValue([record({ licenseStatus: 'unknown' })]);

    expect((await service.forTitles([{ id: 't1', posterPath: '/abc.jpg' }])).size).toBe(0);
  });

  it('withholds a poster with no rights row at all, and never queries for a title without a path', async () => {
    sourceRecords.find.mockResolvedValue([]);
    expect((await service.forTitles([{ id: 't1', posterPath: '/abc.jpg' }])).size).toBe(0);

    expect((await service.forTitles([{ id: 't2', posterPath: null }])).size).toBe(0);
    expect(sourceRecords.find).toHaveBeenCalledTimes(1);
  });

  it('attaches explicit nulls rather than dropping a title that has no displayable poster', async () => {
    sourceRecords.find.mockResolvedValue([]);

    expect(await service.attach([{ id: 't1', posterPath: '/abc.jpg' }])).toEqual([
      { id: 't1', posterPath: '/abc.jpg', posterUrl: null, posterSource: null },
    ]);
  });
});
