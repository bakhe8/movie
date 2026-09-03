import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { UserTitleStateService } from './user-title-state.service';

function repoMock() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
  };
}

describe('UserTitleStateService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: ReturnType<typeof repoMock>;
  let statesRepository: ReturnType<typeof repoMock>;
  let service: UserTitleStateService;

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = repoMock();
    statesRepository = repoMock();
    service = new UserTitleStateService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      statesRepository as unknown as Repository<UserTitleState>,
    );
  });

  describe('upsert', () => {
    it('rejects setting state on a profile owned by another user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.upsert('attacker-user', 'someone-elses-profile', 'title-1', { state: 'watched' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(titlesRepository.findOne).not.toHaveBeenCalled();
      expect(statesRepository.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown title id', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.upsert('user-1', 'profile-1', 'missing-title', { state: 'watched' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stamps watchedAt automatically the first time a title is marked watched', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue(null);

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watched' });

      expect(result.watchedAt).toBeInstanceOf(Date);
      expect(result.state).toBe('watched');
    });

    it('clears watchedAt when the state changes away from watched', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
      statesRepository.findOne.mockResolvedValue({
        profileId: 'profile-1',
        titleId: 'title-1',
        state: 'watched',
        watchedAt: new Date('2026-01-01'),
      });

      const result = await service.upsert('user-1', 'profile-1', 'title-1', { state: 'watchlist' });

      expect(result.watchedAt).toBeNull();
      expect(result.state).toBe('watchlist');
    });
  });

  describe('findByState', () => {
    it('rejects listing state for a profile owned by another user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.findByState('attacker-user', 'someone-elses-profile', 'watched')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(statesRepository.find).not.toHaveBeenCalled();
    });
  });
});
