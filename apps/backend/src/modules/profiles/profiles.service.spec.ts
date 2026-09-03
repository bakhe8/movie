import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { ProfilesService } from './profiles.service';

function repoMock() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
    remove: vi.fn(async (entity: unknown) => entity),
  };
}

describe('ProfilesService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let service: ProfilesService;

  beforeEach(() => {
    profilesRepository = repoMock();
    service = new ProfilesService(profilesRepository as unknown as Repository<Profile>);
  });

  describe('findOne', () => {
    it('throws 404 (not 403) for a profile that belongs to a different user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('attacker-user', 'someone-elses-profile')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(profilesRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'someone-elses-profile', userId: 'attacker-user' },
      });
    });

    it('returns the profile when it belongs to the requesting user', async () => {
      const profile = { id: 'profile-1', userId: 'user-1', name: 'Main' };
      profilesRepository.findOne.mockResolvedValue(profile);

      await expect(service.findOne('user-1', 'profile-1')).resolves.toBe(profile);
    });
  });

  describe('findAll', () => {
    it('scopes the listing to the requesting user only', async () => {
      profilesRepository.find.mockResolvedValue([]);

      await service.findAll('user-1');

      expect(profilesRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('translates a duplicate-name unique violation into a ConflictException', async () => {
      profilesRepository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.create('user-1', { name: 'Main', preferredLanguage: 'en' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('defaults preferredLanguage to ar when not provided (Arabic-first, blueprint §2)', async () => {
      await service.create('user-1', { name: 'Main' });

      expect(profilesRepository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        name: 'Main',
        preferredLanguage: 'ar',
      });
    });
  });

  describe('update', () => {
    it('rejects updating a profile owned by another user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('attacker-user', 'someone-elses-profile', { name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(profilesRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('rejects removing a profile owned by another user', async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('attacker-user', 'someone-elses-profile')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(profilesRepository.remove).not.toHaveBeenCalled();
    });
  });
});
