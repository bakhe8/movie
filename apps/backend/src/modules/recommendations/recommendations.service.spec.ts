import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ModelVersion } from '../../entities/model-version.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import type { PublicQuality, PublicQualityService } from '../public-quality/public-quality.service';
import type { ExperimentsService } from '../experiments/experiments.service';
import type { PosterService } from '../public-quality/poster.service';
import type { TrainingService } from '../training/training.service';
import { RecommendationsService } from './recommendations.service';

const FINGERPRINT_V1_DIMENSIONS = [
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
// ADR-69: 15 namespaced "family.feature" dimensions, matching
// title-fingerprint.type.ts's FINGERPRINT_V2_DIMENSIONS exactly.
const FINGERPRINT_V2_DIMENSIONS = [
  'narrative.revelation',
  'narrative.perspective',
  'narrative.unreliability',
  'tone.irony',
  'tone.unease',
  'tone.catharsis',
  'tone.compassion',
  'characters.agency',
  'characters.moralAmbiguity',
  'characters.transformation',
  'characters.relationshipCentrality',
  'ending.openness',
  'ending.twist',
  'ending.justice',
  'ending.optimism',
];
// ADR-75: 12 more namespaced dimensions, matching title-fingerprint.type.ts's
// FINGERPRINT_V3_DIMENSIONS exactly.
const FINGERPRINT_V3_DIMENSIONS = [
  'rhythm.setupLength',
  'rhythm.turningPointDensity',
  'rhythm.deliberateness',
  'information.expositionDirectness',
  'information.subtext',
  'information.knowledgeComplexity',
  'style.stylization',
  'style.experimentation',
  'style.scale',
  'tone.playfulness',
  'tone.sentimentality',
  'narrative.scope',
];
const FINGERPRINT_DIMENSIONS = [...FINGERPRINT_V1_DIMENSIONS, ...FINGERPRINT_V2_DIMENSIONS, ...FINGERPRINT_V3_DIMENSIONS];

// V1 keys flat at the top level, V2/V3 keys nested under fingerprint.v2.features
// and fingerprint.v3.features -- the real published shape (FINGERPRINT_SCHEMA.md
// §3.1/§3.3), not a flat 40-key object, so fingerprintVector()'s three read
// paths are all actually exercised by every existing test that builds a
// "complete" fingerprint.
function zeroFingerprint(overrides: Record<string, number> = {}) {
  const fingerprint: Record<string, unknown> = {};
  for (const dim of FINGERPRINT_V1_DIMENSIONS) {
    fingerprint[dim] = overrides[dim] ?? 0;
  }
  const v2Features: Record<string, number> = {};
  for (const dim of FINGERPRINT_V2_DIMENSIONS) {
    v2Features[dim] = overrides[dim] ?? 0;
  }
  fingerprint.v2 = { features: v2Features };
  const v3Features: Record<string, number> = {};
  for (const dim of FINGERPRINT_V3_DIMENSIONS) {
    v3Features[dim] = overrides[dim] ?? 0;
  }
  fingerprint.v3 = { features: v3Features };
  return fingerprint;
}

function withoutDimension(fingerprint: Record<string, unknown>, dimension: string) {
  const copy = JSON.parse(JSON.stringify(fingerprint)) as Record<string, unknown>;
  if (FINGERPRINT_V3_DIMENSIONS.includes(dimension)) {
    delete (copy.v3 as { features: Record<string, unknown> }).features[dimension];
  } else if (dimension.includes('.')) {
    delete (copy.v2 as { features: Record<string, unknown> }).features[dimension];
  } else {
    delete copy[dimension];
  }
  return copy;
}

function repoMock() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
  };
}

function queryBuilderMock(titles: Title[], count = titles.length) {
  const builder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(titles),
    getCount: vi.fn().mockResolvedValue(count),
  };
  return builder;
}

function warmthOnlySnapshot(
  trainingTriadCount = 25,
  heldOutPairwiseAccuracy: number | null = null,
  options: {
    posterior?: { standardErrors: number[] } | null;
    trainingGenreDiversity?: number | null;
    trainingLanguageDiversity?: number | null;
    trainingDirectorDiversity?: number | null;
  } = {},
) {
  return {
    weights: FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'warmth' ? 1 : 0)),
    biasTerms: {},
    modelVersion: 'test-v1',
    trainingTriadCount,
    heldOutPairwiseAccuracy,
    posterior: options.posterior ?? null,
    trainingGenreDiversity: options.trainingGenreDiversity ?? null,
    trainingLanguageDiversity: options.trainingLanguageDiversity ?? null,
    trainingDirectorDiversity: options.trainingDirectorDiversity ?? null,
  };
}

describe('RecommendationsService', () => {
  let profilesRepository: ReturnType<typeof repoMock>;
  let titlesRepository: { findOne: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };
  let snapshotsRepository: ReturnType<typeof repoMock>;
  let statesRepository: ReturnType<typeof repoMock>;
  let recommendationsRepository: { insert: ReturnType<typeof vi.fn> };
  let modelVersionsRepository: ReturnType<typeof repoMock>;
  let publicQualityService: { forTitles: ReturnType<typeof vi.fn> };
  let triadsRepository: { count: ReturnType<typeof vi.fn> };
  let posterService: { forTitles: ReturnType<typeof vi.fn> };
  let experimentsService: { armFor: ReturnType<typeof vi.fn> };
  let trainingService: { firstTriadCount: number; summarize: ReturnType<typeof vi.fn> };
  let service: RecommendationsService;

  // Every 'ready' assertion below works on the items; the states have their
  // own tests above.
  async function recommendItems(userId: string, profileId: string, limit: number) {
    const response = await service.findForProfile(userId, profileId, limit);
    if (response.state !== 'ready') {
      throw new Error(`expected a ready response, got ${response.state}`);
    }
    return response.items;
  }

  beforeEach(() => {
    profilesRepository = repoMock();
    titlesRepository = { ...repoMock(), createQueryBuilder: vi.fn() };
    // usualRegion() reads the watched titles' genres/languages; no history
    // by default, so every result is 'safe' unless a test says otherwise.
    titlesRepository.find.mockResolvedValue([]);
    snapshotsRepository = repoMock();
    statesRepository = repoMock();
    recommendationsRepository = { insert: vi.fn().mockResolvedValue({}) };
    modelVersionsRepository = repoMock();
    // No active pin by default -- every existing test keeps serving each
    // profile's own latest snapshot regardless of modelVersion, unchanged.
    modelVersionsRepository.findOne.mockResolvedValue(null);
    publicQualityService = { forTitles: vi.fn().mockResolvedValue(new Map()) };
    triadsRepository = { count: vi.fn().mockResolvedValue(0) };
    posterService = { forTitles: vi.fn().mockResolvedValue(new Map()) };
    // No running experiment: the default exploration share applies.
    experimentsService = { armFor: vi.fn().mockResolvedValue('control') };
    // Nothing requested yet, no rounds: what a fresh profile's pending looks like.
    trainingService = {
      firstTriadCount: 3,
      summarize: vi.fn().mockResolvedValue({ state: 'idle', jobId: null, errorKind: null, completedTriads: 0, nextTrainingAt: 3 }),
    };
    service = new RecommendationsService(
      profilesRepository as unknown as Repository<Profile>,
      titlesRepository as unknown as Repository<Title>,
      snapshotsRepository as unknown as Repository<UserModelSnapshot>,
      statesRepository as unknown as Repository<UserTitleState>,
      recommendationsRepository as unknown as Repository<Recommendation>,
      modelVersionsRepository as unknown as Repository<ModelVersion>,
      publicQualityService as unknown as PublicQualityService,
      triadsRepository as unknown as Repository<Triad>,
      trainingService as unknown as TrainingService,
      posterService as unknown as PosterService,
      experimentsService as unknown as ExperimentsService,
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

      const [top, bottom] = await recommendItems('user-1', 'profile-1', 10);

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

      const result = await recommendItems('user-1', 'profile-1', 10);

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

  // Designed states are 200s with a discriminator, not 4xx (board B→A).
  it('reports pending, with the rounds still needed and the training state, before the model is trained', async () => {
    const profile = { id: 'profile-1', userId: 'user-1', pausedAt: null };
    profilesRepository.findOne.mockResolvedValue(profile);
    snapshotsRepository.findOne.mockResolvedValue(null);
    const training = { state: 'idle', jobId: null, errorKind: null, completedTriads: 1, nextTrainingAt: 3 };
    trainingService.summarize.mockResolvedValue(training);

    expect(await service.findForProfile('user-1', 'profile-1', 10)).toEqual({ state: 'pending', needed: 2, training });
    expect(trainingService.summarize).toHaveBeenCalledWith(profile);
  });

  // Ten rounds and no model must never read as "still learning": the
  // failure travels with the pending state (live round 2026-09-05).
  it('carries a failed training job inside pending once the rounds are enough', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1', pausedAt: null });
    snapshotsRepository.findOne.mockResolvedValue(null);
    trainingService.summarize.mockResolvedValue({
      state: 'failed',
      jobId: 'job-9',
      errorKind: 'invalid',
      completedTriads: 10,
      nextTrainingAt: 13,
    });

    expect(await service.findForProfile('user-1', 'profile-1', 10)).toMatchObject({
      state: 'pending',
      needed: 0,
      training: { state: 'failed', jobId: 'job-9', errorKind: 'invalid' },
    });
  });

  it('reports paused rather than serving a paused profile (PRIVACY.md §4)', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1', pausedAt: new Date() });

    expect(await service.findForProfile('user-1', 'profile-1', 10)).toEqual({ state: 'paused' });
  });

  it('reports model_outdated for a snapshot whose weight vector predates a fingerprint change', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue({ weights: [0.1, 0.2], pairwiseAccuracy: 0.5 });

    expect(await service.findForProfile('user-1', 'profile-1', 10)).toEqual({ state: 'model_outdated' });
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

    const result = await recommendItems('user-1', 'profile-1', 2);

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

  // Blueprint gap 4: without a persisted row, the post-watch loop (§4.5)
  // has nothing to close and §16 has nothing to read.
  describe('persistence (blueprint gap 4)', () => {
    it('writes one recommendations row per shown result, sharing a requestId', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const titles = [
        { id: 'high-warmth', fingerprint: zeroFingerprint({ warmth: 0.9 }) },
        { id: 'mid-warmth', fingerprint: zeroFingerprint({ warmth: 0.5 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(recommendationsRepository.insert).toHaveBeenCalledTimes(1);
      const rows = recommendationsRepository.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.titleId)).toEqual(['high-warmth', 'mid-warmth']);
      expect(rows.every((row) => row.profileId === 'profile-1')).toBe(true);
      expect(rows.every((row) => row.modelVersion === 'test-v1')).toBe(true);
      expect(rows.every((row) => row.confidenceBand === result[0].confidenceBand)).toBe(true);
      // Both rows from the same call share one requestId.
      expect(new Set(rows.map((row) => row.requestId)).size).toBe(1);
      // Honest nulls, not fabricated values (ADR-52/53/56's "flag, don't
      // invent" pattern): no continuous confidence score, no experiment,
      // and today's full-catalog scan matches none of the specified
      // candidateSource values.
      expect(rows.every((row) => row.confidenceRaw === null)).toBe(true);
      expect(rows.every((row) => row.experimentId === null)).toBe(true);
      expect(rows.every((row) => row.candidateSource === null)).toBe(true);
      // Deterministic top-K given the snapshot and pool: every shown item
      // was certain under this policy.
      expect(rows.every((row) => row.selectionPropensity === 1)).toBe(true);
    });

    it('writes nothing when there are no candidates to show', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock([]));

      await recommendItems('user-1', 'profile-1', 10);

      expect(recommendationsRepository.insert).not.toHaveBeenCalled();
    });
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

    const result = await recommendItems('user-1', 'profile-1', 10);

    expect(result[0].confidenceBand).toBe(expectedBand);
  });

  // Blueprint gap 5: §9.2's "successful prediction of later held-out
  // comparisons" criterion. A model that predicts at or below chance (0.5)
  // on held-out triads is conflicting evidence by §9.3's own definition of
  // 'inconclusive' -- this overrides the triad-count band outright.
  describe('confidence band factors in held-out prediction (blueprint gap 5)', () => {
    it('demotes to inconclusive when held-out accuracy is at chance, even with many training triads', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, 0.5));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('demotes to inconclusive when held-out accuracy is below chance', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, 0.3));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('keeps the triad-count band when held-out accuracy clears the band it claims', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, 0.85));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });

    // C8: 30 triads alone used to say 'strong' at 0.67 held-out accuracy --
    // above chance, but not predictive enough for the claim.
    it.each([
      [0.67, 'initial'],
      [0.75, 'likely'],
      [0.8, 'strong'],
    ] as const)('caps the band at what held-out accuracy %f supports: %s', async (accuracy, expected) => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, accuracy));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe(expected);
    });

    it('never raises a band: a high accuracy on few triads stays initial', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(5, 0.95));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('initial');
    });

    it('falls back to the triad-count heuristic when held-out accuracy is unknown (below the 5-triad floor, ADR-31)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      // Unknown is not treated as failing -- 30 triads still bands 'strong'.
      expect(result[0].confidenceBand).toBe('strong');
    });
  });

  // Blueprint gap 5: §9.2's "stable posterior direction beyond a pre-set
  // threshold" -- z = |weight| / standardError, the Laplace approximation
  // to the posterior from ranker.py's BFGS inverse Hessian.
  describe('confidence band factors in posterior stability (blueprint gap 5)', () => {
    function standardErrors(overrides: Record<string, number> = {}) {
      return FINGERPRINT_DIMENSIONS.map((dim) => overrides[dim] ?? 1);
    }

    it('demotes to inconclusive when no dimension is even one standard error from zero', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(
        warmthOnlySnapshot(30, null, { posterior: { standardErrors: standardErrors({ warmth: 10 }) } }),
      );
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('keeps the triad-count band when at least one dimension is stable', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(
        warmthOnlySnapshot(30, null, { posterior: { standardErrors: standardErrors({ warmth: 0.5 }) } }),
      );
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });

    it('falls back to the triad-count heuristic when posterior is unknown (below the 5-triad floor)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { posterior: null }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });
  });

  // Blueprint gap 5: §9.2's "sufficient effective evidence (not one series
  // repeated)" and "diversity of ... genres" read together.
  describe('confidence band factors in training genre diversity (blueprint gap 5)', () => {
    it('demotes to inconclusive when every triad drew from the same one genre', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingGenreDiversity: 1 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('demotes to inconclusive when no title in training had a known genre', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingGenreDiversity: 0 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('keeps the triad-count band with at least 2 distinct genres', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingGenreDiversity: 5 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });

    it('falls back to the triad-count heuristic when diversity is unknown (below the 5-triad floor)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingGenreDiversity: null }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });
  });

  // Blueprint gap 6/gap 5: §9.2's second named diversity axis, original
  // language -- the same "not one series repeated" idea applied to
  // Title.originalLanguage instead of genre.
  describe('confidence band factors in training language diversity (blueprint gap 5/gap 6)', () => {
    it('demotes to inconclusive when every triad drew from the same one language', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingLanguageDiversity: 1 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('demotes to inconclusive when no title in training had a known language', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingLanguageDiversity: 0 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('keeps the triad-count band with at least 2 distinct languages', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingLanguageDiversity: 3 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });

    it('falls back to the triad-count heuristic when diversity is unknown (below the 5-triad floor)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingLanguageDiversity: null }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });
  });

  // Blueprint gap 5 (BP §9.2's third and last named diversity axis),
  // unblocked by gap 6's director-credit ingestion pass (ADR-70) -- same
  // rule as genre/language, mirrored exactly.
  describe('confidence band factors in training director diversity (blueprint gap 5)', () => {
    it('demotes to inconclusive when every triad drew from the same one director', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingDirectorDiversity: 1 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('demotes to inconclusive when no title in training had a known director', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingDirectorDiversity: 0 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('inconclusive');
    });

    it('keeps the triad-count band with at least 2 distinct directors', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingDirectorDiversity: 4 }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });

    it('falls back to the triad-count heuristic when diversity is unknown (below the 5-triad floor)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(30, null, { trainingDirectorDiversity: null }));
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].confidenceBand).toBe('strong');
    });
  });

  it('excludes only titles the profile has watched; a not_watched mark keeps the title a candidate (blueprint §2.4 #3)', async () => {
    profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
    snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot(10));
    statesRepository.find.mockResolvedValue([{ titleId: 'already-watched' }]);

    const builder = queryBuilderMock([]);
    titlesRepository.createQueryBuilder.mockReturnValue(builder);

    await recommendItems('user-1', 'profile-1', 10);

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

    const result = await recommendItems('user-1', 'profile-1', 10);

    // Pool mean of the known warmth values is 0.5, so the unknown title lands in the
    // middle -- had it been zero-filled it would have come last with score 0.
    expect(result.map((item) => item.title.id)).toEqual(['warm', 'warmth-unknown', 'cold']);
    expect(result[1].personalFitScore).toBeCloseTo(0.5);
    expect(result[1].fingerprintCoverage).toBeCloseTo(39 / 40);
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

    const result = await recommendItems('user-1', 'profile-1', 10);

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

    const result = await recommendItems('user-1', 'profile-1', 10);

    expect(result.map((item) => item.title.id)).toEqual(['described']);
  });

  // ADR-69: the second half of the 28-dimension vector is namespaced and
  // nested under fingerprint.v2.features rather than flat like V1.
  describe('V2 fingerprint families (ADR-69)', () => {
    it('scores a title on a V2 dimension the same way it scores a V1 one', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue({
        weights: FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'tone.irony' ? 1 : 0)),
        biasTerms: {},
        modelVersion: 'test-v2',
        trainingTriadCount: 25,
      });
      statesRepository.find.mockResolvedValue([]);
      const titles = [
        { id: 'ironic', fingerprint: zeroFingerprint({ 'tone.irony': 0.9 }) },
        { id: 'earnest', fingerprint: zeroFingerprint({ 'tone.irony': 0.1 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result.map((item) => item.title.id)).toEqual(['ironic', 'earnest']);
    });

    it('imputes a whole missing v2 block with the pool mean rather than excluding the title (ADR-19)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const v1Only = { schemaVersion: 'film-fingerprint-v1', ...Object.fromEntries(FINGERPRINT_V1_DIMENSIONS.map((dim) => [dim, dim === 'warmth' ? 0.6 : 0])) };
      const titles = [
        { id: 'v1-only', fingerprint: v1Only },
        { id: 'v1-and-v2', fingerprint: zeroFingerprint({ warmth: 0.6 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      // A title with no "v2" block at all (true of the original 15 seed
      // titles today) is still scored -- it is not dropped the way a
      // fingerprint with zero known dimensions is (the test above this one).
      expect(result.map((item) => item.title.id).sort()).toEqual(['v1-and-v2', 'v1-only']);
      const v1OnlyResult = result.find((item) => item.title.id === 'v1-only');
      expect(v1OnlyResult?.fingerprintCoverage).toBeCloseTo(FINGERPRINT_V1_DIMENSIONS.length / FINGERPRINT_DIMENSIONS.length);
    });

    it('can cite a V2 dimension in the reason (blueprint §9.4)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue({
        weights: FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'ending.optimism' ? 1 : 0)),
        biasTerms: {},
        modelVersion: 'test-v2',
        trainingTriadCount: 25,
      });
      statesRepository.find.mockResolvedValue([]);
      const titles = [
        { id: 'hopeful', fingerprint: zeroFingerprint({ 'ending.optimism': 0.9 }) },
        { id: 'bitter', fingerprint: zeroFingerprint({ 'ending.optimism': 0.1 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].reason.features).toEqual([{ key: 'ending.optimism', direction: 'higher' }]);
    });
  });

  describe('V3 fingerprint families (ADR-75)', () => {
    it('scores a title on a V3 dimension the same way it scores a V1 one', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue({
        weights: FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'tone.playfulness' ? 1 : 0)),
        biasTerms: {},
        modelVersion: 'test-v3',
        trainingTriadCount: 25,
      });
      statesRepository.find.mockResolvedValue([]);
      const titles = [
        { id: 'playful', fingerprint: zeroFingerprint({ 'tone.playfulness': 0.9 }) },
        { id: 'serious', fingerprint: zeroFingerprint({ 'tone.playfulness': 0.1 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result.map((item) => item.title.id)).toEqual(['playful', 'serious']);
    });

    it('imputes a whole missing v3 block with the pool mean rather than excluding the title (ADR-19)', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const withoutV3 = zeroFingerprint({ warmth: 0.6 }) as Record<string, unknown>;
      delete withoutV3.v3;
      const titles = [
        { id: 'v1v2-only', fingerprint: withoutV3 },
        { id: 'v1v2v3', fingerprint: zeroFingerprint({ warmth: 0.6 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      // A title with no "v3" block at all (true of every title neither
      // enrichment pass has touched yet) is still scored -- not dropped.
      expect(result.map((item) => item.title.id).sort()).toEqual(['v1v2-only', 'v1v2v3']);
      const withoutV3Result = result.find((item) => item.title.id === 'v1v2-only');
      const v1v2Length = FINGERPRINT_V1_DIMENSIONS.length + FINGERPRINT_V2_DIMENSIONS.length;
      expect(withoutV3Result?.fingerprintCoverage).toBeCloseTo(v1v2Length / FINGERPRINT_DIMENSIONS.length);
    });
  });

  // ADR-8 / ALPHA_PLAN 6.3: three deterministic tracks with a declared
  // exploration share.
  describe('tracks (ADR-8)', () => {
    function titleWith(id: string, warmth: number, genres: string[], originalLanguage: string | null) {
      return { id, genres, originalLanguage, fingerprint: zeroFingerprint({ warmth }) } as unknown as Title;
    }

    beforeEach(() => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([{ titleId: 'watched-1' }]);
      // The profile's history: Drama, in Arabic.
      titlesRepository.find.mockResolvedValue([
        { id: 'watched-1', genres: ['Drama'], originalLanguage: 'ar' },
      ] as unknown as Title[]);
    });

    it('labels a candidate inside the known region safe, and one crossing genre or language discovery', async () => {
      const titles = [
        titleWith('same-region', 0.9, ['Drama'], 'ar'),
        titleWith('other-genre', 0.8, ['Horror'], 'ar'),
        titleWith('other-language', 0.7, ['Drama'], 'ja'),
      ];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 3);

      expect(items.map((item) => [item.title.id, item.track])).toEqual([
        ['same-region', 'safe'],
        ['other-genre', 'discovery'],
        ['other-language', 'discovery'],
      ]);
    });

    it('spends the declared exploration share on the tail of the ranking, not the head', async () => {
      const titles = Array.from({ length: 10 }, (_, index) =>
        titleWith(`t${index}`, (10 - index) / 10, ['Drama'], 'ar'),
      );
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 10);

      // 20% of 10 = 2 exploration slots, filled from the worst-ranked titles.
      expect(items.filter((item) => item.track === 'outside_usual').map((item) => item.title.id)).toEqual(['t8', 't9']);
      expect(items.slice(0, 8).every((item) => item.track !== 'outside_usual')).toBe(true);
    });

    it('calls nothing a discovery for a profile with no history to cross', async () => {
      statesRepository.find.mockResolvedValue([]);
      titlesRepository.find.mockResolvedValue([]);
      const titles = [titleWith('a', 0.9, ['Horror'], 'ja'), titleWith('b', 0.5, ['Drama'], 'ar')];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 2);

      expect(items.every((item) => item.track === 'safe')).toBe(true);
    });

    // A-13, found live by session B: a profile whose candidate pool is
    // smaller than the requested limit came back all-`safe`. The share has to
    // be spent on what there actually is to show, not on the number asked
    // for -- otherwise the head slots swallow the whole pool and the
    // exploration track silently disappears exactly when the catalogue is
    // thinnest, which is when a bubble forms most easily.
    it('still spends the share when the pool is smaller than the requested limit', async () => {
      const titles = Array.from({ length: 7 }, (_, index) =>
        titleWith(`t${index}`, (10 - index) / 10, ['Drama'], 'ar'),
      );
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 12);

      // 20% of the 7 available = 1 slot, taken from the worst-ranked.
      expect(items).toHaveLength(7);
      expect(items.filter((item) => item.track === 'outside_usual').map((item) => item.title.id)).toEqual(['t6']);
    });

    // Board 15 (the A-13 observation, re-verified 2026-09-05): a live round
    // of 7 came back all-`safe` with both other tracks empty. With history to
    // cross, 7 shown at share 0.2 is floor(1.4) = 1 exploration slot -- so an
    // all-safe 7 is only ever the no-history case above, never the share
    // silently not applying. Pinned here at the screen's own limit.
    it('gives a round of 7 exactly one outside_usual slot when the profile has history', async () => {
      const titles = Array.from({ length: 30 }, (_, index) =>
        titleWith(`t${index}`, (30 - index) / 30, ['Drama'], 'ar'),
      );
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 7);

      expect(items).toHaveLength(7);
      expect(items.slice(0, 6).map((item) => item.track)).toEqual(Array(6).fill('safe'));
      // The one exploration slot comes from the tail of the full ranking.
      expect(items[6]).toMatchObject({ track: 'outside_usual', title: { id: 't29' } });
    });

    // The floor still applies: with four candidates, 20% is 0.8 of a slot and
    // no title is promoted to a track it did not earn.
    it('spends nothing when the share does not add up to a whole slot', async () => {
      const titles = Array.from({ length: 4 }, (_, index) =>
        titleWith(`t${index}`, (10 - index) / 10, ['Drama'], 'ar'),
      );
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 12);

      expect(items).toHaveLength(4);
      expect(items.every((item) => item.track !== 'outside_usual')).toBe(true);
    });

    // The other half of A-13's answer. `crosses()` needs *every* genre of a
    // candidate to sit outside the profile's union of watched genres, so the
    // wider that union grows the harder `discovery` is to reach -- a profile
    // that has watched a Drama and a Horror gets no discovery from a
    // Drama/Horror title, only from a language it has never watched. That is
    // the current definition, pinned here so it cannot drift unnoticed; BP
    // §4.4 wanted a "non-obvious link", and whether this is strict enough or
    // too strict is an open product question, not a silent implementation
    // detail.
    it('does not call a partial genre overlap a discovery, however wide the history', async () => {
      statesRepository.find.mockResolvedValue([{ titleId: 'watched-1' }, { titleId: 'watched-2' }]);
      titlesRepository.find.mockResolvedValue([
        { id: 'watched-1', genres: ['Drama'], originalLanguage: 'ar' },
        { id: 'watched-2', genres: ['Horror'], originalLanguage: 'ar' },
      ] as unknown as Title[]);
      const titles = [
        titleWith('overlaps', 0.9, ['Drama', 'Horror'], 'ar'),
        titleWith('half-overlaps', 0.8, ['Drama', 'Comedy'], 'ar'),
        titleWith('fully-outside', 0.7, ['Comedy'], 'ar'),
      ];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 3);
      const tracks = new Map(items.map((item) => [item.title.id, item.track]));

      expect(tracks.get('overlaps')).toBe('safe');
      expect(tracks.get('half-overlaps')).toBe('safe');
      expect(tracks.get('fully-outside')).toBe('discovery');
    });

    // A-16 (owner decision O-7). The old filter asked a yes/no question and
    // dropped everything short of its answer; the score asks how far outside
    // and takes the best available, so the two cases below both have one.
    describe('crossing score (O-7)', () => {
      beforeEach(() => {
        // Watches Drama and Horror, in Arabic.
        statesRepository.find.mockResolvedValue([{ titleId: 'watched-1' }, { titleId: 'watched-2' }]);
        titlesRepository.find.mockResolvedValue([
          { id: 'watched-1', genres: ['Drama'], originalLanguage: 'ar' },
          { id: 'watched-2', genres: ['Horror'], originalLanguage: 'ar' },
        ] as unknown as Title[]);
      });

      it('leads with the fully outside candidate when there is one', async () => {
        const titles = [
          titleWith('inside', 0.9, ['Drama'], 'ar'),
          titleWith('genre-only', 0.8, ['Comedy'], 'ar'),
          titleWith('language-only', 0.7, ['Drama'], 'ja'),
          titleWith('both', 0.6, ['Comedy'], 'ja'),
        ];
        titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

        const items = await recommendItems('user-1', 'profile-1', 4);
        const discoveries = items.filter((item) => item.track === 'discovery').map((item) => item.title.id);

        // Score 2 beats the two score-1 near-misses, which stay `safe`.
        expect(discoveries).toEqual(['both']);
      });

      // The failure the score exists to remove: under the old filter a
      // catalogue with nothing fully outside showed an empty discovery
      // section, which is exactly when a bubble is forming.
      it('shows the closest candidate when nothing is fully outside', async () => {
        const titles = [
          titleWith('inside', 0.9, ['Drama'], 'ar'),
          titleWith('genre-only', 0.8, ['Comedy'], 'ar'),
          titleWith('language-only', 0.7, ['Horror'], 'ja'),
        ];
        titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

        const items = await recommendItems('user-1', 'profile-1', 3);
        const discoveries = items.filter((item) => item.track === 'discovery').map((item) => item.title.id);

        expect(discoveries).toEqual(['genre-only', 'language-only']);
      });

      // Nothing crosses at all: still no discovery. A section that always
      // fills itself would eventually label an ordinary title a discovery,
      // which is worse than an empty one.
      it('leaves the track empty when nothing crosses at all', async () => {
        const titles = [titleWith('a', 0.9, ['Drama'], 'ar'), titleWith('b', 0.8, ['Horror'], 'ar')];
        titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

        const items = await recommendItems('user-1', 'profile-1', 2);

        expect(items.every((item) => item.track === 'safe')).toBe(true);
      });
    });

    it('takes the exploration share from the running experiment arm when there is one', async () => {
      experimentsService.armFor.mockResolvedValue('exploration-high');
      const titles = Array.from({ length: 10 }, (_, index) =>
        titleWith(`t${index}`, (10 - index) / 10, ['Drama'], 'ar'),
      );
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const items = await recommendItems('user-1', 'profile-1', 10);

      // 35% of 10 = 3 slots.
      expect(items.filter((item) => item.track === 'outside_usual')).toHaveLength(3);
    });
  });

  // F10, BP §18.1's rollback control: AdminModelsService.updateModel() already
  // enforced at most one active model_versions row, but nothing read it back
  // -- activating a version had no effect on what was actually served.
  describe('serving the model_versions.active pin (F10, BP §18.1)', () => {
    it('queries model_versions for the active pin before falling back to each profile\'s latest snapshot when none is active', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      await recommendItems('user-1', 'profile-1', 10);

      expect(modelVersionsRepository.findOne).toHaveBeenCalledWith({ where: { active: true } });
    });

    it('serves the snapshot trained under the active model version, not merely the profile\'s latest', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      modelVersionsRepository.findOne.mockResolvedValue({ version: 'pinned-version', active: true });
      const pinnedSnapshot = { ...warmthOnlySnapshot(), modelVersion: 'pinned-version' };
      snapshotsRepository.findOne.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve('modelVersion' in where ? pinnedSnapshot : { ...warmthOnlySnapshot(), modelVersion: 'newer-unpinned-version' }),
      );
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].modelVersion).toBe('pinned-version');
    });

    it('falls back to the profile\'s own latest snapshot when it has none trained under the active version', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      modelVersionsRepository.findOne.mockResolvedValue({ version: 'pinned-version', active: true });
      const latestSnapshot = { ...warmthOnlySnapshot(), modelVersion: 'this-profile-never-reached-the-pin' };
      snapshotsRepository.findOne.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve('modelVersion' in where ? null : latestSnapshot),
      );
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].modelVersion).toBe('this-profile-never-reached-the-pin');
    });
  });

  // G4, BP §10.3/§4.4: Public Quality is a separate value from Personal Fit,
  // never merged into it -- PublicQualityService.forTitles() was already
  // built and used by GET /titles/:id (TitlesService), but findForProfile()
  // never called it, so publicQualityScore stayed hardcoded null even once
  // real IMDb data existed.
  describe('public quality (G4)', () => {
    it('batches PublicQualityService.forTitles() over only the titles actually returned, not the whole candidate pool', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const titles = [
        { id: 'a', fingerprint: zeroFingerprint({ warmth: 0.9 }) },
        { id: 'b', fingerprint: zeroFingerprint({ warmth: 0.1 }) },
      ] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));

      await recommendItems('user-1', 'profile-1', 1);

      expect(publicQualityService.forTitles).toHaveBeenCalledWith(['a']);
    });

    it('exposes the full multi-source object and its single-source convenience value on the result', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));
      const quality: PublicQuality = {
        value: 7.8,
        votes: 12000,
        sources: [{ source: 'imdb', value: 7.8, scale: '0-10', votes: 12000, capturedAt: '2026-09-04T00:00:00.000Z', attribution: 'IMDb rating' }],
      };
      publicQualityService.forTitles.mockResolvedValue(new Map([['title-1', quality]]));

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].publicQuality).toEqual(quality);
      expect(result[0].publicQualityScore).toBe(7.8);
    });

    it('leaves both fields null for a title with no displayable public-quality source, never a fabricated 0', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));
      publicQualityService.forTitles.mockResolvedValue(new Map());

      const result = await recommendItems('user-1', 'profile-1', 10);

      expect(result[0].publicQuality).toBeNull();
      expect(result[0].publicQualityScore).toBeNull();
    });

    it('persists publicQualityScore into the recommendations row', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1' });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      statesRepository.find.mockResolvedValue([]);
      const titles = [{ id: 'title-1', fingerprint: zeroFingerprint() }] as unknown as Title[];
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock(titles));
      const quality: PublicQuality = { value: 6.2, votes: 500, sources: [] };
      publicQualityService.forTitles.mockResolvedValue(new Map([['title-1', quality]]));

      await recommendItems('user-1', 'profile-1', 10);

      expect(recommendationsRepository.insert).toHaveBeenCalledWith([expect.objectContaining({ publicQuality: 6.2 })]);
    });
  });

  // ADR-103: the cheap discriminator ProfileReadinessService reads, without
  // paying for the scored candidate pipeline.
  describe('snapshotState', () => {
    it('mirrors findForProfile\'s own discriminator', async () => {
      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1', pausedAt: null });
      snapshotsRepository.findOne.mockResolvedValue(warmthOnlySnapshot());
      await expect(service.snapshotState('user-1', 'profile-1')).resolves.toBe('ready');

      snapshotsRepository.findOne.mockResolvedValue(null);
      await expect(service.snapshotState('user-1', 'profile-1')).resolves.toBe('pending');

      profilesRepository.findOne.mockResolvedValue({ id: 'profile-1', userId: 'user-1', pausedAt: new Date() });
      await expect(service.snapshotState('user-1', 'profile-1')).resolves.toBe('paused');
    });
  });

  describe('candidatePoolSize', () => {
    it('counts unwatched, fingerprinted titles without scoring them', async () => {
      statesRepository.find.mockResolvedValue([{ titleId: 'watched-1' }]);
      const builder = queryBuilderMock([], 7);
      titlesRepository.createQueryBuilder.mockReturnValue(builder);

      await expect(service.candidatePoolSize('profile-1')).resolves.toBe(7);

      expect(builder.andWhere).toHaveBeenCalledWith('title.id NOT IN (:...excludedTitleIds)', { excludedTitleIds: ['watched-1'] });
    });

    it('returns 0 rather than throwing when nothing is left to recommend', async () => {
      statesRepository.find.mockResolvedValue([]);
      titlesRepository.createQueryBuilder.mockReturnValue(queryBuilderMock([], 0));

      await expect(service.candidatePoolSize('profile-1')).resolves.toBe(0);
    });
  });
});
