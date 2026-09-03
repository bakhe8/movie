import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Title } from '../../entities/title.entity';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';
import { TitlesService } from './titles.service';

function queryBuilderMock(items: Partial<Title>[], total: number) {
  return {
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getManyAndCount: vi.fn().mockResolvedValue([items, total]),
  };
}

function listQuery(overrides: Partial<ListTitlesQueryDto> = {}): ListTitlesQueryDto {
  const dto = new ListTitlesQueryDto();
  Object.assign(dto, { page: 1, limit: 20, ...overrides });
  return dto;
}

describe('TitlesService', () => {
  let titlesRepository: { findOne: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };
  let service: TitlesService;

  beforeEach(() => {
    titlesRepository = { findOne: vi.fn(), createQueryBuilder: vi.fn() };
    service = new TitlesService(titlesRepository as unknown as Repository<Title>);
  });

  describe('findAll', () => {
    // M2: the catalog was public and returned the full entity, including the
    // licensed fingerprint and third-party externalIds. Now auth-guarded
    // (TitlesController) and, independently, never even fetched from the DB.
    it('selects only the public columns -- never fingerprint or externalIds', async () => {
      const builder = queryBuilderMock([{ id: 't-1', titleEn: 'Arrival' }], 1);
      titlesRepository.createQueryBuilder.mockReturnValue(builder);

      await service.findAll(listQuery());

      const selectedColumns = builder.select.mock.calls[0][0] as string[];
      expect(selectedColumns).toEqual(
        expect.arrayContaining(['title.id', 'title.titleEn', 'title.titleAr', 'title.releaseYear']),
      );
      expect(selectedColumns).not.toContain('title.fingerprint');
      expect(selectedColumns).not.toContain('title.externalIds');
    });

    it('paginates and reports totals from the query builder', async () => {
      const builder = queryBuilderMock([{ id: 't-1' }, { id: 't-2' }], 45);
      titlesRepository.createQueryBuilder.mockReturnValue(builder);

      const result = await service.findAll(listQuery({ page: 2, limit: 10 }));

      expect(builder.skip).toHaveBeenCalledWith(10);
      expect(builder.take).toHaveBeenCalledWith(10);
      expect(result).toMatchObject({ page: 2, limit: 10, total: 45, totalPages: 5 });
      expect(result.items).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('never selects fingerprint or externalIds from the DB', async () => {
      titlesRepository.findOne.mockResolvedValue({ id: 't-1', titleEn: 'Arrival' });

      await service.findOne('t-1');

      const call = titlesRepository.findOne.mock.calls[0][0];
      expect(call.where).toEqual({ id: 't-1' });
      expect(call.select.fingerprint).toBeUndefined();
      expect(call.select.externalIds).toBeUndefined();
      expect(call.select.titleEn).toBe(true);
    });

    it('throws 404 for an unknown title', async () => {
      titlesRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
