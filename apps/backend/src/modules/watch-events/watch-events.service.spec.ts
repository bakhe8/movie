import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { WatchEvent } from '../../entities/watch-event.entity';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { UserTitleStateService } from '../user-title-state/user-title-state.service';
import { WatchEventsService } from './watch-events.service';

function repoMock() {
  return {
    findOne: vi.fn(),
    save: vi.fn(async (entity: unknown) => entity),
    create: vi.fn((data: unknown) => data),
  };
}

describe('WatchEventsService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: ReturnType<typeof repoMock>;
  let recommendationsRepository: ReturnType<typeof repoMock>;
  let watchEventsRepository: ReturnType<typeof repoMock>;
  let outcomesRepository: ReturnType<typeof repoMock>;
  let userTitleStateService: { upsert: ReturnType<typeof vi.fn> };
  let analyticsService: { record: ReturnType<typeof vi.fn> };
  let service: WatchEventsService;

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = repoMock();
    recommendationsRepository = repoMock();
    watchEventsRepository = repoMock();
    outcomesRepository = repoMock();
    userTitleStateService = { upsert: vi.fn().mockResolvedValue({}) };
    analyticsService = { record: vi.fn().mockResolvedValue(undefined) };
    service = new WatchEventsService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      recommendationsRepository as unknown as Repository<Recommendation>,
      watchEventsRepository as unknown as Repository<WatchEvent>,
      outcomesRepository as unknown as Repository<Outcome>,
      userTitleStateService as unknown as UserTitleStateService,
      analyticsService as unknown as AnalyticsService,
    );
  });

  // ALPHA_PLAN 7.5: whether the loop closed is the one thing worth counting
  // here. What was watched stays in watch_events -- a title id has no place
  // in a counter.
  it('records the watch with whether it followed a recommendation, and no title id', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1' });

    await service.create('user-1', 'profile-1', { titleId: 'title-1', source: 'in_app' } as never);

    const [profileId, name, properties] = analyticsService.record.mock.calls[0];
    expect([profileId, name]).toEqual(['profile-1', 'watch_marked']);
    expect(properties).toEqual({ source: 'in_app', fromRecommendation: true });
  });

  it('rejects recording a watch for a profile owned by another user', async () => {
    profilesRepository.findOne.mockResolvedValue(null);

    await expect(
      service.create('attacker-user', 'someone-elses-profile', { titleId: 'title-1', source: 'in_app' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(titlesRepository.findOne).not.toHaveBeenCalled();
    expect(watchEventsRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an unknown title id', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue(null);

    await expect(
      service.create('user-1', 'profile-1', { titleId: 'missing-title', source: 'in_app' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(watchEventsRepository.save).not.toHaveBeenCalled();
  });

  it('records a watch event with no linked recommendation when none was ever shown for this title', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
    recommendationsRepository.findOne.mockResolvedValue(null);

    const result = await service.create('user-1', 'profile-1', {
      titleId: 'title-1',
      source: 'manual',
      audioLanguage: 'ar',
      subtitleLanguage: 'en',
      provider: 'netflix',
    });

    expect(result).toMatchObject({
      profileId: 'profile-1',
      titleId: 'title-1',
      source: 'manual',
      audioLanguage: 'ar',
      subtitleLanguage: 'en',
      provider: 'netflix',
      recommendationId: null,
    });
    expect(outcomesRepository.save).not.toHaveBeenCalled();
  });

  it('links the most recent recommendation for this (profile, title) and closes the loop with an outcomes row', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1', profileId: 'profile-1', titleId: 'title-1' });

    const result = await service.create('user-1', 'profile-1', { titleId: 'title-1', source: 'in_app' });

    expect(result.recommendationId).toBe('rec-1');
    expect(recommendationsRepository.findOne).toHaveBeenCalledWith({
      where: { profileId: 'profile-1', titleId: 'title-1' },
      order: { createdAt: 'DESC' },
    });
    expect(outcomesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ recommendationId: 'rec-1', type: 'watched' }),
    );
    expect(outcomesRepository.save).toHaveBeenCalled();
  });

  it('does not imply liking: neither the outcome nor the watch event carries any rating/preference value', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1' });

    const result = await service.create('user-1', 'profile-1', { titleId: 'title-1', source: 'in_app' });

    expect(result).not.toHaveProperty('rating');
    const [outcomeArg] = outcomesRepository.create.mock.calls[0];
    expect(outcomeArg).not.toHaveProperty('rating');
  });

  it('defaults watchedAt to now when the caller omits it', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
    recommendationsRepository.findOne.mockResolvedValue(null);

    const before = Date.now();
    const result = await service.create('user-1', 'profile-1', { titleId: 'title-1', source: 'in_app' });
    const after = Date.now();

    expect(result.watchedAt).toBeInstanceOf(Date);
    expect((result.watchedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((result.watchedAt as Date).getTime()).toBeLessThanOrEqual(after);
  });

  it('uses the caller-supplied watchedAt for both the watch event and the outcome, not the current time', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
    recommendationsRepository.findOne.mockResolvedValue({ id: 'rec-1' });

    const result = await service.create('user-1', 'profile-1', {
      titleId: 'title-1',
      source: 'import',
      watchedAt: '2026-01-15T10:00:00.000Z',
    });

    expect(result.watchedAt).toEqual(new Date('2026-01-15T10:00:00.000Z'));
    const [outcomeArg] = outcomesRepository.create.mock.calls[0];
    expect(outcomeArg.occurredAt).toEqual(new Date('2026-01-15T10:00:00.000Z'));
  });

  it('marks the title watched (BP §4.5: it returns to appropriate triads) via the same upsert PATCH .../state uses', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    titlesRepository.findOne.mockResolvedValue({ id: 'title-1' });
    recommendationsRepository.findOne.mockResolvedValue(null);

    await service.create('user-1', 'profile-1', {
      titleId: 'title-1',
      source: 'in_app',
      watchedAt: '2026-01-15T10:00:00.000Z',
    });

    // ADR-104: the state PATCH now takes a plain calendar day, derived here
    // from this event's own watchedAt (its UTC date -- the best available
    // day this path has, no separate day-only input exists).
    expect(userTitleStateService.upsert).toHaveBeenCalledWith('user-1', 'profile-1', 'title-1', {
      state: 'watched',
      watchedOn: '2026-01-15',
    });
  });
});
