import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Title } from '../../entities/title.entity';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';

// What every catalog read returns -- never the raw fingerprint or external
// ids (M2, blueprint §5.3/§21.3, DATA_LICENSING.md): the fingerprint is a
// licensed, derived asset, and §5.3 only allows a reviewed *summary* of it on
// the work page, which doesn't exist yet. Not fetched from the DB at all
// (see the `select` lists below), not just omitted from the response.
export type PublicTitle = Omit<Title, 'fingerprint' | 'externalIds'>;

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
      queryBuilder.where(
        new Brackets((where) => {
          where
            .where('title.titleEn ILIKE :searchTerm', { searchTerm })
            .orWhere('title.titleAr ILIKE :searchTerm', { searchTerm });
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

  async findOne(titleId: string): Promise<PublicTitle> {
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
    return title;
  }
}