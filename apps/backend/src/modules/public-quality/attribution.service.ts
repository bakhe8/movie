import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { ATTRIBUTION_BY_SOURCE, DISPLAYABLE_LICENSE_STATUSES } from './public-quality.constants';

// What the work page shows under a text field: the source's display name,
// the attribution line the source requires, and the page the text came
// from (the rights-registry row's `value` for Wikipedia rows). Same shape
// as `posterSource` plus the link CC BY-SA asks for.
export interface TextSource {
  name: string;
  attribution: string | null;
  url: string | null;
}

const SOURCE_NAME: Record<string, string> = {
  'wikipedia:en': 'Wikipedia',
  'wikipedia:ar': 'ويكيبيديا',
  wikidata: 'Wikidata',
};

// Closes the attribution loop for text the way PublicQualityService does
// for scores (ALPHA_PLAN 5.1 follow-up): reads the rights registry, never a
// hard-coded credit. A field with no current, displayable row gets null --
// the client then shows the text without a credit line rather than
// inventing one, and the admin board's "missing rights" view is where that
// gap is visible.
@Injectable()
export class AttributionService {
  constructor(
    @InjectRepository(SourceRecord)
    private readonly sourceRecordsRepository: Repository<SourceRecord>,
  ) {}

  async descriptionSource(titleId: string): Promise<TextSource | null> {
    return this.textSource(titleId, 'description');
  }

  async textSource(titleId: string, fieldName: string): Promise<TextSource | null> {
    // Current rows only (a superseded row points at its replacement); the
    // newest wins when the loader has been run more than once.
    const row = await this.sourceRecordsRepository.findOne({
      where: { titleId, fieldName, supersededBy: IsNull(), licenseStatus: In([...DISPLAYABLE_LICENSE_STATUSES]) },
      order: { validFrom: 'DESC', createdAt: 'DESC' },
    });
    if (!row) {
      return null;
    }
    return {
      name: SOURCE_NAME[row.source] ?? row.source,
      // Credited even when the license does not require it (CC0): the line
      // exists for the source, so it is shown.
      attribution: ATTRIBUTION_BY_SOURCE[row.source] ?? null,
      url: row.value && /^https?:\/\//.test(row.value) ? row.value : null,
    };
  }
}
