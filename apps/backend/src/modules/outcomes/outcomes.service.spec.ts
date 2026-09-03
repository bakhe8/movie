import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { OutcomesService } from './outcomes.service';

function repoMock() {
  return {
    findOne: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
  };
}

describe('OutcomesService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let recommendationsRepository: ReturnType<typeof repoMock>;
  let outcomesRepository: ReturnType<typeof repoMock>;
  let service: OutcomesService;

  beforeEach(() => {
    profilesRepository = repoMock();
    recommendationsRepository = repoMock();
    outcomesRepository = repoMock();
    service = new OutcomesService(
      profilesRepository as unknown as Repository<Profile>,
      recommendationsRepository as unknown as Repository<Recommendation>,
      outcomesRepository as unknown as Repository<Outcome>,
    );
  });

  it('rejects an unknown recommendation id', async () => {
    recommendationsRepository.findOne.mockResolvedValue(null);

    await expect(service.create('user-1', 'missing-rec', { type: 'saved' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(profilesRepository.findOne).not.toHaveBeenCalled();
    expect(outcomesRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a recommendation belonging to another user (IDOR), same error as an unknown id', async () => {
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1', profileId: 'someone-elses-profile' });
    profilesRepository.findOne.mockResolvedValue(null);

    const unknownIdError = await service.create('attacker-user', 'missing-rec', { type: 'saved' }).catch((e) => e);
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1', profileId: 'someone-elses-profile' });
    const otherUserError = await service.create('attacker-user', 'rec-1', { type: 'saved' }).catch((e) => e);

    expect(otherUserError).toBeInstanceOf(NotFoundException);
    expect(otherUserError.message).toBe(unknownIdError.message);
    expect(outcomesRepository.save).not.toHaveBeenCalled();
  });

  it('writes an outcome row of the given type, timestamped now', async () => {
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1', profileId: 'profile-1' });
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

    const before = Date.now();
    const result = await service.create('user-1', 'rec-1', { type: 'saved' });
    const after = Date.now();

    expect(result).toMatchObject({ recommendationId: 'rec-1', type: 'saved' });
    expect((result.occurredAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((result.occurredAt as Date).getTime()).toBeLessThanOrEqual(after);
  });

  it.each(['saved', 'clicked', 'dismissed_not_relevant', 'opened_provider'] as const)(
    'accepts type %s',
    async (type) => {
      recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1', profileId: 'profile-1' });
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

      const result = await service.create('user-1', 'rec-1', { type });

      expect(result.type).toBe(type);
    },
  );

  it('writes a second row rather than overwriting the first when acted on twice (append-only, not a toggle)', async () => {
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1', profileId: 'profile-1' });
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

    await service.create('user-1', 'rec-1', { type: 'clicked' });
    await service.create('user-1', 'rec-1', { type: 'clicked' });

    expect(outcomesRepository.save).toHaveBeenCalledTimes(2);
  });
});
