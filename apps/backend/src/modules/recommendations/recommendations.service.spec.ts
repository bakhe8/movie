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

function withoutDimension(fingerprint: Record<string, number>, dimension: string) {
  const copy = { ...fingerprint };
  delete copy[dimension];
  return copy;
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

function warmthOnlySnapshot(trainingTriadCount = 25) {
  return {
    weights: FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'warmth' ? 1 : 0)),
    biasTerms: {},
    modelVersion: 'test-v1',
    trainingTriadCount,
  };
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

  // The reason names only the dimensions that lifted a title above the pool
  // (blueprint §9.4, ADR-20): w_i × (φ_i − mean_i) > 0, top two, and never an
  // imputed dimension. Wording is the client's; the API sends keys.
  describe('reason', () => {
    it('cites the driving dimensions with their direction, and nothing else', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue({
        // Likes warmth, dislikes darkness, indifferent to everything else.
        weights: FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'warmth' ? 1 : dim === 'darkness' ? -1 : 0)),
        biasTerms: {},
        modelVersion: 'test-v1',
        trainingTriadCount: 25,
      });
      statesRepository.find.mockResolvedValue([]);
      const titles = [
        { id: 'warm-and-bright', fingerprint: zeroFingerprint({ warmth: 0.9, darkness: 0.1, pacing: 0.9 }) },
        { id: 'cold-and-dark', fingerprint: zeroFingerprint({ warmth: 0.1, darkness: 0.9, pacing: 0.1 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const [top, bottom] = await service.findForProfile('user-1', 'profile-1', 10);

      expect(top.title.id).toBe('warm-and-bright');
      // Warmth above the pool mean with a positive weight, darkness below it
      // with a negative weight -- both lifted the score; pacing has zero
      // weight and is never cited even though the title is fast.
      expect(top.reason).toEqual({
        features: [
          { key: 'warmth', direction: 'higher' },
          { key: 'darkness', direction: 'lower' },
        ],
        evidenceSource: 'individual',
      });
      // Nothing lifted the bottom title: an honest empty reason, not a made-up one.
      expect(bottom.reason.features).toEqual([]);
    });

    it('never cites a dimension the title does not know (imputed = no contribution)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const titles = [
        { id: 'unknown-warmth', fingerprint: withoutDimension(zeroFingerprint({ pacing: 0.9 }), 'warmth') },
        { id: 'known-warmth', fingerprint: zeroFingerprint({ warmth: 0.2 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await service.findForProfile('user-1', 'profile-1', 10);

      const unknown = result.find((item) => item.title.id === 'unknown-warmth');
      expect(unknown?.reason.features).toEqual([]);
    });
  });

  // The library's personal ranking (blueprint §5.3, SPECIFICATION §5.4): the
  // same scoring path, pointed at the watched set instead of the unwatched one,
  // and exposed as positions only (ADR-33).
  describe('rankLibrary', () => {
    it("throws 404 (not 403) for another user's profile", async () => {
      profilesRepository.findOne.mockResolvedValue(null);

      await expect(service.rankLibrary('attacker-user', 'someone-elses-profile')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to rank before the preference model has been trained', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(null);

      await expect(service.rankLibrary('user-1', 'profile-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('returns an empty ranking, without querying titles, when nothing is watched', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);

      expect(await service.rankLibrary('user-1', 'profile-1')).toEqual([]);
      expect(titlesRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('ranks only the watched, fingerprinted titles by the model, as positions without a score', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([{ titleId: 'a' }, { titleId: 'b' }, { titleId: 'c' }]);
      const titles = [
        { id: 'a', fingerprint: zeroFingerprint({ warmth: 0.2 }) },
        { id: 'b', fingerprint: zeroFingerprint({ warmth: 0.9 }) },
        { id: 'c', fingerprint: zeroFingerprint({ warmth: 0.5 }) },
      ] as unknown as Title[];
      const builder = queryBuilderMock(titles);
      titlesRepository.createQueryBuilder.mockReturnValue(builder);

      const result = await service.rankLibrary('user-1', 'profile-1');

      // Watched set in, not out -- the mirror image of the recommendation query.
      expect(builder.andWhere).toHaveBeenCalledWith('title.id IN (:...watchedTitleIds)', {
        watchedTitleIds: ['a', 'b', 'c'],
      });
      expect(result.map((item) => [item.title.id, item.position])).toEqual([
        ['b', 1],
        ['c', 2],
        ['a', 3],
      ]);
      // A library ranking is a prediction surface: ordinal positions only, the
      // score never leaves the server (ADR-33).
      expect(result[0]).not.toHaveProperty('personalFitScore');
      expect(result[0].confidenceBand).toBe('strong');
      expect(result[0].modelVersion).toBe('test-v1');
      // The same driving-feature reason as a recommendation, relative to
      // the watched set: warmth lifted the top title, nothing lifted the last.
      expect(result[0].reason).toEqual({ features: [{ key: 'warmth', direction: 'higher' }], evidenceSource: 'individual' });
      expect(result[2].reason.features).toEqual([]);
    });

    it('demotes the band one step for a watched title with an unknown dimension (ADR-19)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([{ titleId: 'full' }, { titleId: 'partial' }]);
      const titles = [
        { id: 'full', fingerprint: zeroFingerprint({ warmth: 0.9 }) },
        { id: 'partial', fingerprint: withoutDimension(zeroFingerprint({ warmth: 0.8 }), 'pacing') },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await service.rankLibrary('user-1', 'profile-1');

      expect(result.find((item) => item.title.id === 'full')?.confidenceBand).toBe('strong');
      expect(result.find((item) => item.title.id === 'partial')?.confidenceBand).toBe('likely');
      expect(result.find((item) => item.title.id === 'partial')?.fingerprintCoverage).toBeLessThan(1);
    });
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
    snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
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
    expect(result[0].fingerprintCoverage).toBe(1);
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

  it('excludes only titles the profile has watched; a not_watched mark keeps the title a candidate (blueprint §2.4 #3)', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(10));
    statesRepository.find.mockResolvedValue([{ titleId: 'already-watched' }]);

    const builder = queryBuilderMock([]);
    titlesRepository.createQueryBuilder.mockReturnValue(builder);

    await service.findForProfile('user-1', 'profile-1', 10);

    expect(statesRepository.find).toHaveBeenCalledWith({
      where: { profileId: 'profile-1', state: 'watched' },
      select: { titleId: true },
    });
    expect(builder.andWhere).toHaveBeenCalledWith('title.id NOT IN (:...excludedTitleIds)', {
      excludedTitleIds: ['already-watched'],
    });
  });

  it('imputes an unknown dimension with the candidate-pool mean instead of zero (ADR-19)', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
    statesRepository.find.mockResolvedValue([]);

    const titles = [
      { id: 'cold', fingerprint: zeroFingerprint({ warmth: 0.2 }) },
      { id: 'warm', fingerprint: zeroFingerprint({ warmth: 0.8 }) },
      { id: 'warmth-unknown', fingerprint: withoutDimension(zeroFingerprint(), 'warmth') },
    ] as unknown as Title[];
    titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

    const result = await service.findForProfile('user-1', 'profile-1', 10);

    // Pool mean of the known warmth values is 0.5, so the unknown title lands in the
    // middle -- had it been zero-filled it would have come last with score 0.
    expect(result.map((item) => item.title.id)).toEqual(['warm', 'warmth-unknown', 'cold']);
    expect(result[1].personalFitScore).toBeCloseTo(0.5);
    expect(result[1].fingerprintCoverage).toBeCloseTo(12 / 13);
  });

  it('demotes the confidence band one step for a title with unknown dimensions', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(25));
    statesRepository.find.mockResolvedValue([]);

    const titles = [
      { id: 'complete', fingerprint: zeroFingerprint({ warmth: 0.9 }) },
      { id: 'partial', fingerprint: withoutDimension(zeroFingerprint({ warmth: 0.8 }), 'pacing') },
    ] as unknown as Title[];
    titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

    const result = await service.findForProfile('user-1', 'profile-1', 10);

    expect(result.find((item) => item.title.id === 'complete')?.confidenceBand).toBe('strong');
    expect(result.find((item) => item.title.id === 'partial')?.confidenceBand).toBe('likely');
  });

  it('drops a title whose fingerprint has no numeric dimension at all', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
    statesRepository.find.mockResolvedValue([]);

    const titles = [
      { id: 'described', fingerprint: zeroFingerprint({ warmth: 0.4 }) },
      { id: 'themes-only', fingerprint: { schemaVersion: 'film-fingerprint-v1', themes: ['loss'] } },
    ] as unknown as Title[];
    titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

    const result = await service.findForProfile('user-1', 'profile-1', 10);

    expect(result.map((item) => item.title.id)).toEqual(['described']);
  });
});
