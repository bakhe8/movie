import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { RecommendationsService } from './recommendations.service';

const FINGERPRINT_DIMENSIONS = [
  'pacing',
  'rhythmVariance',
  'ambiguity',
  'psychologicalDepth',
  'warmth',
  'darkness',
  'linearity',
  'dialogueDensity',
  'actionIntensity',
  'plotComplexity',
  'visualComplexity',
  'soundscapeComplexity',
  'colorSaturation',
];

function zeroFingerprint(overrides: Record<string, number> = {}) {
  return FINGERPRINT_DIMENSIONS.reduce<Record<string, number>>((acc, dim) => {
    acc[dim] = overrides[dim] ?? 0;
    return acc;
  }, {});
}

function repoMock() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
  };
}

function queryBuilderMock(titles: Title[]) {
  const builder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(titles),
  };
  return builder;
}

describe('RecommendationsService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: { findOne: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };
  let snapshotsRepository: ReturnType<typeof repoMock>;
  let statesRepository: ReturnType<typeof repoMock>;
  let service: RecommendationsService;

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = { ...repoMock(), createQueryBuilder: vi.fn() };
    snapshotsRepository = repoMock();
    statesRepository = repoMock();
    service = new RecommendationsService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      snapshotsRepository as unknown as Repository<UserModelSnapshot>,
      statesRepository as unknown as Repository<UserTitleState>,
    );
  });

  it('throws 404 (not 403) for a profile owned by another user', async () => {
    profilesRepository.findOne.mockResolvedValue(null);

    await expect(service.findForProfile('attacker-user', 'someone-elses-profile', 10)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to recommend before the preference model has been trained', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue(null);

    await expect(service.findForProfile('user-1', 'profile-1', 10)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to score against a snapshot whose weight vector does not match the fingerprint schema', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue({ weights: [0.1, 0.2], pairwiseAccuracy: 0.5 });

    await expect(service.findForProfile('user-1', 'profile-1', 10)).rejects.toBeInstanceOf(ConflictException);
  });

  it('scores, ranks descending, and truncates to the requested limit', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });

    const weights = FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'warmth' ? 1 : 0));
    snapshotsRepository.findOne.mockResolvedValue({
      weights,
      biasTerms: {},
      modelVersion: 'test-v1',
      trainingTriadCount: 25,
    });
    statesRepository.find.mockResolvedValue([]);

    const titles = [
      { id: 'low-warmth', fingerprint: zeroFingerprint({ warmth: 0.1 }) },
      { id: 'high-warmth', fingerprint: zeroFingerprint({ warmth: 0.9 }) },
      { id: 'mid-warmth', fingerprint: zeroFingerprint({ warmth: 0.5 }) },
    ] as unknown as Title[];
    titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

    const result = await service.findForProfile('user-1', 'profile-1', 2);

    expect(result).toHaveLength(2);
    expect(result[0].title.id).toBe('high-warmth');
    expect(result[1].title.id).toBe('mid-warmth');
    expect(result[0].personalFitScore).toBeCloseTo(0.9);
    // Personal Fit, Public Quality, and Watchability must stay separate -- never merged
    // into one score (blueprint §4.4).
    expect(result[0].publicQualityScore).toBeNull();
    expect(result[0].watchabilityScore).toBeNull();
    // A verbal band, not a raw percentage, until calibrated (blueprint §7.2/§9.3).
    expect(result[0].confidenceBand).toBe('strong');
    expect(result[0].track).toBe('safe');
    expect(result[0].modelVersion).toBe('test-v1');
  });

  it.each([
    [2, 'inconclusive'],
    [5, 'initial'],
    [15, 'likely'],
    [30, 'strong'],
  ] as const)('bands confidence by evidence quantity: %i triads -> %s', async (trainingTriadCount, expectedBand) => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue({
      weights: FINGERPRINT_DIMENSIONS.map(() => 0),
      biasTerms: {},
      modelVersion: 'test-v1',
      trainingTriadCount,
    });
    statesRepository.find.mockResolvedValue([]);
    const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
    titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

    const result = await service.findForProfile('user-1', 'profile-1', 10);

    expect(result[0].confidenceBand).toBe(expectedBand);
  });

  it('excludes titles the profile has already watched or marked not-watched', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue({
      weights: FINGERPRINT_DIMENSIONS.map(() => 0),
      biasTerms: {},
      modelVersion: 'test-v1',
      trainingTriadCount: 10,
    });
    statesRepository.find.mockResolvedValue([{ titleId: 'already-watched' }]);

    const builder = queryBuilderMock([]);
    titlesRepository.createQueryBuilder.mockReturnValue(builder);

    await service.findForProfile('user-1', 'profile-1', 10);

    expect(builder.andWhere).toHaveBeenCalledWith('title.id NOT IN (:...excludedTitleIds)', {
      excludedTitleIds: ['already-watched'],
    });
  });
});
