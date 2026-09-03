import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { TriadsService } from './triads.service';

function repoMock() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
    createQueryBuilder: vi.fn(),
  };
}

function titlesQueryBuilderMock(titles: Title[], poolSize: number) {
  return {
    orderBy: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getManyAndCount: vi.fn().mockResolvedValue([titles, poolSize]),
  };
}

describe('TriadsService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: ReturnType<typeof repoMock>;
  let triadsRepository: ReturnType<typeof repoMock>;
  let statesRepository: ReturnType<typeof repoMock>;
  let service: TriadsService;

  const otherUserProfile = { id: 'profile-owned-by-someone-else' };

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = repoMock();
    triadsRepository = repoMock();
    statesRepository = repoMock();
    service = new TriadsService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      triadsRepository as unknown as Repository<Triad>,
      statesRepository as unknown as Repository<UserTitleState>,
    );
  });

  describe('rank', () => {
    const activeTriad = { id: 'triad-1', profileId: 'profile-1', status: 'active' as const };

    it('rejects a ranking that is not a permutation of [0,1,2] before touching the database', async () => {
      await expect(
        service.rank('user-1', 'triad-1', { ranking: [0, 0, 1] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.rank('user-1', 'triad-1', { ranking: [0, 1] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.rank('user-1', 'triad-1', { ranking: [0, 1, 3] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(triadsRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws 404 when the triad does not exist', async () => {
      triadsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.rank('user-1', 'missing-triad', { ranking: [0, 1, 2] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 (not 403) when the triad belongs to a profile owned by another user', async () => {
      triadsRepository.findOne.mockResolvedValue(activeTriad);
      profilesRepository.findOne.mockResolvedValue(null); // no profile row matches {id, userId}

      await expect(
        service.rank('attacker-user', 'triad-1', { ranking: [0, 1, 2] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(profilesRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'profile-1', userId: 'attacker-user' },
      });
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects submitting a ranking for an already-completed triad', async () => {
      triadsRepository.findOne.mockResolvedValue({ ...activeTriad, status: 'completed' });
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

      await expect(
        service.rank('user-1', 'triad-1', { ranking: [0, 1, 2] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a valid ranking from the owning user and marks the triad completed', async () => {
      triadsRepository.findOne.mockResolvedValue({ ...activeTriad });
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

      const result = await service.rank('user-1', 'triad-1', { ranking: [2, 0, 1], sessionId: 's1' });

      expect(result.status).toBe('completed');
      expect(result.ranking).toEqual([2, 0, 1]);
      expect(triadsRepository.save).toHaveBeenCalled();
    });
  });

  describe('getCurrent', () => {
    it('throws 404 when the profile does not belong to the requesting user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.getCurrent('attacker-user', otherUserProfile.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the existing active triad instead of creating a new one', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      const existing = { id: 'triad-active', profileId: 'profile-1', status: 'active' };
      triadsRepository.findOne.mockResolvedValue(existing);

      const result = await service.getCurrent('user-1', 'profile-1');

      expect(result).toBe(existing);
      expect(triadsRepository.save).not.toHaveBeenCalled();
    });

    it('requires at least three watched titles before a triad can be created', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne.mockResolvedValue(null); // no active triad
      triadsRepository.find.mockResolvedValue([]); // no completed triads
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }]); // only 2 watched

      await expect(service.getCurrent('user-1', 'profile-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(titlesRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns the winning row instead of a duplicate when it loses a race to create the active triad', async () => {
      // Two concurrent getCurrent() calls for the same profile can both see
      // "no active triad" and both attempt to insert one; the DB's partial
      // unique index (migration AddOneActiveTriadPerProfileConstraint) lets
      // only one succeed, and the loser must return that row, not error.
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      const winner = { id: 'triad-winner', profileId: 'profile-1', status: 'active' as const };
      triadsRepository.findOne
        .mockResolvedValueOnce(null) // no active triad yet, when we first check
        .mockResolvedValueOnce(winner); // re-fetched after losing the insert race
      triadsRepository.find.mockResolvedValue([]); // no completed triads
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
      titlesRepository.createQueryBuilder.mockReturnValue(
        titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3),
      );
      triadsRepository.save.mockRejectedValue({ code: '23505' });

      const result = await service.getCurrent('user-1', 'profile-1');

      expect(result).toBe(winner);
    });

    it('does not swallow a save error unrelated to the unique constraint', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.findOne.mockResolvedValue(null);
      triadsRepository.find.mockResolvedValue([]);
      statesRepository.find.mockResolvedValue([{ titleId: 't1' }, { titleId: 't2' }, { titleId: 't3' }]);
      titlesRepository.createQueryBuilder.mockReturnValue(
        titlesQueryBuilderMock([{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Title[], 3),
      );
      triadsRepository.save.mockRejectedValue(new Error('connection lost'));

      await expect(service.getCurrent('user-1', 'profile-1')).rejects.toThrow('connection lost');
    });
  });

  describe('findCompleted', () => {
    it('throws 404 when the profile does not belong to the requesting user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.findCompleted('attacker-user', otherUserProfile.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(triadsRepository.find).not.toHaveBeenCalled();
    });

    it('scopes the query to the owning profile', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      triadsRepository.find.mockResolvedValue([{ id: 'triad-1' }]);

      const result = await service.findCompleted('user-1', 'profile-1');

      expect(triadsRepository.find).toHaveBeenCalledWith({
        where: { profileId: 'profile-1', status: 'completed' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([{ id: 'triad-1' }]);
    });
  });
});
