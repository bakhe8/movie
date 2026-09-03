import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Title } from '../../entities/title.entity';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';

export interface PaginatedTitles {
  items: Title[];
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
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(titleId: string): Promise<Title> {
    const title = await this.titlesRepository.findOne({ where: { id: titleId } });
    if (!title) {
      throw new NotFoundException('Title not found');
    }
    return title;
  }
}