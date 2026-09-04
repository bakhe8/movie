import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ContentFeature } from '../../entities/content-feature.entity';
import { Title } from '../../entities/title.entity';
import { AttributionService, TextSource } from '../public-quality/attribution.service';
import { PublicQuality, PublicQualityService } from '../public-quality/public-quality.service';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';
import { ARABIC_FOLD_FROM, ARABIC_FOLD_TO, diversify, foldArabic } from './starter';

// The starter list is drawn from at most this many catalogue rows (by
// title): enough to be diverse, bounded so it never scans a large catalogue.
const STARTER_POOL_SIZE = 300;

// What every catalog read returns -- never the raw fingerprint or external
// ids (M2, blueprint §5.3/§21.3, DATA_LICENSING.md): the fingerprint is a
// licensed, derived asset, and §5.3 only allows a reviewed *summary* of it on
// the work page, which doesn't exist yet. Not fetched from the DB at all
// (see the `select` lists below), not just omitted from the response.
export type PublicTitle = Omit<Title, 'fingerprint' | 'externalIds'>;

// The work page (`GET /titles/:id`, BP §5.3): Public Quality travels as its
// own value with its source and attribution, never merged into anything;
// null when no displayable source exists (BP §11.3), never 0. The
// description's credit comes from the rights registry the same way
// (`descriptionSource`, the shape of `posterSource` plus the page link).
export type WorkPageTitle = PublicTitle & {
  publicQuality: PublicQuality | null;
  descriptionSource: TextSource | null;
  fingerprintSummary: FingerprintSummaryEntry[] | null;
};

// The fingerprint summary the work page shows (API.md `GET /titles/:id`,
// board B2): human-reviewed dimensions only, as a level rather than the raw
// number -- the public read has never exposed `fingerprint` itself (M2), and
// a level is what the copy describes anyway. `null` when nothing on this
// title has been reviewed yet, which the screen renders as "no fingerprint
// published for this work yet" -- never an empty-looking zero.
export interface FingerprintSummaryEntry {
  key: string;
  level: 'low' | 'mid' | 'high';
}

const REVIEWED = 'human_reviewed';
// Thirds of the 0-1 scale every published dimension uses.
function levelOf(value: number): FingerprintSummaryEntry['level'] {
  if (value < 1 / 3) {
    return 'low';
  }
  return value < 2 / 3 ? 'mid' : 'high';
}

const PUBLIC_TITLE_COLUMNS = [
  'title.id',
  'title.internalId',
  'title.titleEn',
  'title.titleAr',
  'title.description',
  'title.releaseYear',
  'title.genres',
  'title.createdAt',
  'title.updatedAt',
] as const;

export interface PaginatedTitles {
  items: PublicTitle[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class TitlesService {
  constructor(
    @InjectRepository(Title)
    private readonly titlesRepository: Repository<Title>,
    private readonly publicQualityService: PublicQualityService,
    private readonly attributionService: AttributionService,
    @InjectRepository(ContentFeature)
    private readonly contentFeaturesRepository: Repository<ContentFeature>,
  ) {}

  async findAll(query: ListTitlesQueryDto): Promise<PaginatedTitles> {
    const page = query.page;
    const limit = query.limit;
    const queryBuilder = this.titlesRepository
      .createQueryBuilder('title')
      .select([...PUBLIC_TITLE_COLUMNS])
      .orderBy('title.titleEn', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.query) {
      const searchTerm = `%${query.query}%`;
      // Arabic folding on both sides (see ./starter foldArabic): the column
      // is folded with translate() over the same character map, so «احلام»
      // finds «أحلام» and «مدرسه» finds «مدرسة». Alternate titles
      // (localized_titles, FTS) are still the M3 gap.
      const foldedTerm = `%${foldArabic(query.query)}%`;
      queryBuilder.where(
        new Brackets((where) => {
          where
            .where('title.titleEn ILIKE :searchTerm', { searchTerm })
            .orWhere('title.titleAr ILIKE :searchTerm', { searchTerm })
            .orWhere('translate(title.titleAr, :foldFrom, :foldTo) ILIKE :foldedTerm', {
              foldFrom: ARABIC_FOLD_FROM,
              foldTo: ARABIC_FOLD_TO,
              foldedTerm,
            });
        }),
      );
    }

    const [items, total] = await queryBuilder.getManyAndCount();
    return {
      items: items as PublicTitle[],
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  // A genre-diverse, deterministic sample for a user who has marked nothing
  // yet (blueprint §4.2, SPECIFICATION §5.1 step 3). No taste input: there
  // is none at this point.
  async starter(limit: number): Promise<PublicTitle[]> {
    const pool = await this.titlesRepository
      .createQueryBuilder('title')
      .select([...PUBLIC_TITLE_COLUMNS])
      .orderBy('title.titleEn', 'ASC')
      .take(STARTER_POOL_SIZE)
      .getMany();
    return diversify(pool as PublicTitle[], limit);
  }

  async findOne(titleId: string): Promise<WorkPageTitle> {
    const title = await this.titlesRepository.findOne({
      where: { id: titleId },
      select: {
        id: true,
        internalId: true,
        titleEn: true,
        titleAr: true,
        description: true,
        releaseYear: true,
        genres: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!title) {
      throw new NotFoundException('Title not found');
    }
    const [publicQuality, descriptionSource, fingerprintSummary] = await Promise.all([
      this.publicQualityService.forTitle(titleId),
      title.description ? this.attributionService.descriptionSource(titleId) : Promise.resolve(null),
      this.fingerprintSummary(titleId),
    ]);
    return { ...title, publicQuality, descriptionSource, fingerprintSummary };
  }

  // One entry per reviewed dimension, newest extractor version per key, in
  // the order the rows come back; a row whose value is NULL is unknown, not
  // zero (BP §11.3), and is skipped rather than levelled.
  private async fingerprintSummary(titleId: string): Promise<FingerprintSummaryEntry[] | null> {
    const rows = await this.contentFeaturesRepository.find({
      where: { titleId, reviewStatus: REVIEWED },
      order: { featureKey: 'ASC' },
    });
    const entries = rows
      .filter((row) => typeof row.value === 'number' && Number.isFinite(row.value))
      .map((row) => ({ key: row.featureKey, level: levelOf(row.value as number) }));
    return entries.length > 0 ? entries : null;
  }
}
