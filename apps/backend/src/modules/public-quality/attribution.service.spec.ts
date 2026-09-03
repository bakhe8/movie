import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { SourceRecord } from '../../entities/source-record.entity';
import { AttributionService } from './attribution.service';

function record(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    id: 'sr',
    titleId: 't1',
    fieldName: 'description',
    source: 'wikipedia:en',
    value: 'https://en.wikipedia.org/wiki/Cairo_Station',
    licenseStatus: 'commercial_allowed',
    attributionRequired: true,
    supersededBy: null,
    ...overrides,
  } as SourceRecord;
}

describe('AttributionService', () => {
  let repository: { findOne: ReturnType<typeof vi.fn> };
  let service: AttributionService;

  beforeEach(() => {
    repository = { findOne: vi.fn().mockResolvedValue(null) };
    service = new AttributionService(repository as unknown as Repository<SourceRecord>);
  });

  it('returns null when the registry has no current, displayable row for the field', async () => {
    expect(await service.descriptionSource('t1')).toBeNull();
    const where = repository.findOne.mock.calls[0][0].where;
    expect(where).toMatchObject({ titleId: 't1', fieldName: 'description' });
    // Superseded rows and unknown/pending statuses are excluded in the query itself.
    expect(where.supersededBy).toBeDefined();
    expect(where.licenseStatus).toBeDefined();
  });

  it('maps a Wikipedia row to its name, the CC BY-SA line and the page link', async () => {
    repository.findOne.mockResolvedValue(record({}));

    expect(await service.descriptionSource('t1')).toEqual({
      name: 'Wikipedia',
      attribution: 'Text from Wikipedia, licensed CC BY-SA 4.0',
      url: 'https://en.wikipedia.org/wiki/Cairo_Station',
    });
  });

  it('maps a Wikidata row: credited though not required, with no page link (the value is a QID)', async () => {
    repository.findOne.mockResolvedValue(record({ source: 'wikidata', value: 'wikidata:Q765535', attributionRequired: false }));

    expect(await service.descriptionSource('t1')).toEqual({ name: 'Wikidata', attribution: 'Data from Wikidata (CC0)', url: null });
  });

  it('falls back to the raw source key for a source it has no name or line for', async () => {
    repository.findOne.mockResolvedValue(record({ source: 'own', value: null }));

    expect(await service.descriptionSource('t1')).toEqual({ name: 'own', attribution: null, url: null });
  });
});
