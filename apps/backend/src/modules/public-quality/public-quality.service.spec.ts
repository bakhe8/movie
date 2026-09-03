import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { PublicQualitySource } from '../../entities/public-quality-source.entity';
import type { SourceRecord } from '../../entities/source-record.entity';
import { ATTRIBUTION_BY_SOURCE, IMDB_SOURCE } from './public-quality.constants';
import { PublicQualityService } from './public-quality.service';

function row(overrides: Partial<PublicQualitySource>): PublicQualitySource {
  return {
    id: 'q',
    titleId: 't1',
    source: IMDB_SOURCE,
    market: null,
    value: 7.8,
    scale: '0-10',
    votes: 1200,
    polarization: null,
    capturedAt: new Date('2026-09-04T00:00:00Z'),
    sourceRecordId: 'sr-ok',
    ...overrides,
  } as PublicQualitySource;
}

function record(overrides: Partial<SourceRecord>): SourceRecord {
  return { id: 'sr-ok', licenseStatus: 'non_commercial_only', attributionRequired: true, ...overrides } as SourceRecord;
}

describe('PublicQualityService', () => {
  let qualityRepository: { find: ReturnType<typeof vi.fn> };
  let sourceRecordsRepository: { find: ReturnType<typeof vi.fn> };
  let service: PublicQualityService;

  beforeEach(() => {
    qualityRepository = { find: vi.fn().mockResolvedValue([]) };
    sourceRecordsRepository = { find: vi.fn().mockResolvedValue([]) };
    service = new PublicQualityService(
      qualityRepository as unknown as Repository<PublicQualitySource>,
      sourceRecordsRepository as unknown as Repository<SourceRecord>,
    );
  });

  it('returns null, not 0, for a title with no row at all', async () => {
    expect(await service.forTitle('t1')).toBeNull();
    expect(qualityRepository.find).toHaveBeenCalledTimes(1);
  });

  it('does not query at all for an empty id list', async () => {
    expect((await service.forTitles([])).size).toBe(0);
    expect(qualityRepository.find).not.toHaveBeenCalled();
  });

  it('returns the value with its scale, votes, date and the required attribution line', async () => {
    qualityRepository.find.mockResolvedValue([row({})]);
    sourceRecordsRepository.find.mockResolvedValue([record({})]);

    const quality = await service.forTitle('t1');

    expect(quality).toEqual({
      value: 7.8,
      votes: 1200,
      sources: [
        {
          source: IMDB_SOURCE,
          value: 7.8,
          scale: '0-10',
          votes: 1200,
          capturedAt: '2026-09-04T00:00:00.000Z',
          attribution: ATTRIBUTION_BY_SOURCE[IMDB_SOURCE],
        },
      ],
    });
  });

  // DATA_LICENSING.md §0 / BP App. B: a value whose registry row has no
  // known license status is not shown, even though it is in the table.
  it.each(['unknown', 'pending_review'] as const)('hides a value whose registry row is %s', async (licenseStatus) => {
    qualityRepository.find.mockResolvedValue([row({})]);
    sourceRecordsRepository.find.mockResolvedValue([record({ licenseStatus })]);

    expect(await service.forTitle('t1')).toBeNull();
  });

  it('hides a value whose registry row is missing', async () => {
    qualityRepository.find.mockResolvedValue([row({ sourceRecordId: 'sr-gone' })]);
    sourceRecordsRepository.find.mockResolvedValue([]);

    expect(await service.forTitle('t1')).toBeNull();
  });

  // BP §11.3: corrections are new rows; the read side takes the newest per
  // (title, source) and ignores the superseded one.
  it('takes the newest row per (title, source) when the loader has superseded an older value', async () => {
    qualityRepository.find.mockResolvedValue([
      row({ id: 'new', value: 8.1, votes: 1500, capturedAt: new Date('2026-10-01T00:00:00Z'), sourceRecordId: 'sr-new' }),
      row({ id: 'old', value: 7.8, votes: 1200, capturedAt: new Date('2026-09-04T00:00:00Z'), sourceRecordId: 'sr-old' }),
    ]);
    sourceRecordsRepository.find.mockResolvedValue([record({ id: 'sr-new' }), record({ id: 'sr-old', supersededBy: 'sr-new' })]);

    const quality = await service.forTitle('t1');

    expect(quality?.sources).toHaveLength(1);
    expect(quality).toMatchObject({ value: 8.1, votes: 1500 });
  });

  // BP §10.3: never averaged. Two sources -> both listed, no top-level number.
  it('lists two sources separately and leaves the top-level value null instead of averaging', async () => {
    qualityRepository.find.mockResolvedValue([
      row({ id: 'a', source: IMDB_SOURCE, value: 8, sourceRecordId: 'sr-a' }),
      row({ id: 'b', source: 'other', value: 6, votes: 10, sourceRecordId: 'sr-b' }),
    ]);
    sourceRecordsRepository.find.mockResolvedValue([record({ id: 'sr-a' }), record({ id: 'sr-b', attributionRequired: false })]);

    const quality = await service.forTitle('t1');

    expect(quality?.sources.map((s) => [s.source, s.value, s.attribution])).toEqual([
      [IMDB_SOURCE, 8, ATTRIBUTION_BY_SOURCE[IMDB_SOURCE]],
      ['other', 6, null],
    ]);
    expect(quality?.value).toBeNull();
    expect(quality?.votes).toBeNull();
  });

  it('groups rows by title for a batch', async () => {
    qualityRepository.find.mockResolvedValue([row({ titleId: 't1', sourceRecordId: 'sr-1' }), row({ titleId: 't2', value: 5.5, sourceRecordId: 'sr-2' })]);
    sourceRecordsRepository.find.mockResolvedValue([record({ id: 'sr-1' }), record({ id: 'sr-2' })]);

    const byTitle = await service.forTitles(['t1', 't2', 't3']);

    expect(byTitle.get('t1')?.value).toBe(7.8);
    expect(byTitle.get('t2')?.value).toBe(5.5);
    expect(byTitle.has('t3')).toBe(false);
  });
});
