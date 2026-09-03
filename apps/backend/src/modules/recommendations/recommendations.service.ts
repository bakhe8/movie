import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { QueryDeepPartialEntity, Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { FINGERPRINT_V2_DIMENSIONS } from '../../entities/title-fingerprint.type';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';

// Versions the selection mechanism itself (blueprint §16 reproducibility),
// distinct from modelVersion (which snapshot supplied the weights). Bump
// this if the candidate pool or ranking mechanism changes materially --
// mirrors TriadsService's TRIAD_POLICY_VERSION.
const RECOMMENDATION_POLICY_VERSION = 'personal-fit-greedy-v1';

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
] as const;
// First V2 family pass (ADR-69, FINGERPRINT_SCHEMA.md §3.1): 13 V1 + 15
// V2 dimensions, V1 first -- matches services/workers/src/training.py's
// FINGERPRINT_DIMENSIONS exactly (both trainer and scorer must agree on
// dimension order, since UserModelSnapshot.weights is a plain array
// positioned by this order, not a keyed map).
const FINGERPRINT_DIMENSIONS = [...FINGERPRINT_V1_DIMENSIONS, ...FINGERPRINT_V2_DIMENSIONS] as const;

export type ConfidenceBand = 'initial' | 'likely' | 'strong' | 'inconclusive';
export type RecommendationTrack = 'safe' | 'discovery' | 'outside_usual';

// Why a title ranks where it does (blueprint §9.4, ADR-20): only the
// fingerprint dimensions that actually raised its score, as keys and a
// direction -- the client owns the wording. `evidenceSource` is always
// 'individual' in MVP (SPECIFICATION §5.3; phase 1 of BP §7.6).
export interface RecommendationReason {
  features: { key: (typeof FINGERPRINT_DIMENSIONS)[number]; direction: 'higher' | 'lower' }[];
  evidenceSource: 'individual';
}

// At most this many driving features per reason; each must carry at least
// this share of the strongest one, so a reason never lists noise.
const REASON_MAX_FEATURES = 2;
const REASON_MIN_SHARE_OF_TOP = 0.2;

// A pairwise comparison is a coin flip at 0.5; at or below that the model
// has not been shown to predict held-out comparisons any better than
// chance (blueprint §9.2's "successful prediction of later held-out
// comparisons" criterion, inverted). Matches BP §9.3's own inconclusive
// definition ("conflicting evidence") -- this is not an arbitrary number,
// it is the domain-standard floor for a binary comparison.
const HELD_OUT_CHANCE_ACCURACY = 0.5;

// z = |weight| / standardError. 1.0 is the most permissive defensible bar --
// "at least one standard error from zero", not a strict significance test
// (that would be ~1.96 for 95% confidence) -- consistent with
// confidenceBand()'s own "deliberately conservative... a soft heuristic, not
// a rigorous test" posture (blueprint gap 5, BP §9.2 "stable posterior
// direction beyond a pre-set threshold").
const POSTERIOR_STABILITY_Z = 1.0;

// Fewer than 2 distinct genres across the triads a snapshot was trained on
// is exactly "one series repeated" (BP §9.2's own phrase) -- the minimal
// floor for "not just one thing".
const MIN_TRAINING_GENRE_DIVERSITY = 2;

// Same floor, the second of §9.2's three named diversity axes: fewer than 2
// distinct Title.originalLanguage values across the training triads. The
// third axis (director) has no data yet -- people/credits/source_records
// stay empty until a real ingestion pass runs (blueprint gap 6).
const MIN_TRAINING_LANGUAGE_DIVERSITY = 2;

// One step down per band. A title with unknown fingerprint dimensions cannot be
// recommended with the same confidence as a fully described one (blueprint §9.1
// "fingerprint confidence", §9.2 last criterion; ADR-19).
const BAND_DEMOTION: Record<ConfidenceBand, ConfidenceBand> = {
  strong: 'likely',
  likely: 'initial',
  initial: 'inconclusive',
  inconclusive: 'inconclusive',
};

// Personal Fit, Public Quality, and Watchability are always three separate values,
// never merged into one number, and confidence is a verbal band rather than a raw
// percentage until it has been calibrated against confirmed post-watch outcomes
// (blueprint §4.4, §7.2, §9.3; docs/SCHEMA.md `recommendations`).
export interface RecommendationResult {
  title: Title;
  personalFitScore: number;
  // Neither has a data source yet (no critic/audience-prior ingestion, no
  // availability integration) -- explicitly null, never a fabricated number, per
  // the "missing is NULL/unknown, never false or 0" rule (blueprint §11.3).
  publicQualityScore: number | null;
  watchabilityScore: number | null;
  confidenceBand: ConfidenceBand;
  // Fraction (0-1) of fingerprint dimensions actually known for this title.
  // Unknown dimensions are imputed with the candidate-pool mean, never zero, and
  // cost one confidence band (blueprint §11.3; ADR-19).
  fingerprintCoverage: number;
  // Every result is 'safe' today -- there is no discovery/outside-usual selection
  // policy implemented yet (blueprint §4.4, §8). Not fabricated, just not built.
  track: RecommendationTrack;
  modelVersion: string;
  reason: RecommendationReason;
}

// The library's personal ranking (blueprint §5.3 "ترتيب شخصي", SPECIFICATION
// §5.4): the profile's watched, fingerprinted titles ordered by the same
// snapshot that ranks recommendations. Positions only -- the score is
// deliberately not exposed, because a library ranking is a prediction surface
// and is shown as ordinal positions, never as numbers (ADR-33).
export interface LibraryRankingItem {
  title: Title;
  position: number;
  confidenceBand: ConfidenceBand;
  fingerprintCoverage: number;
  modelVersion: string;
  // Why the model places it here: the same driving-feature reason as a
  // recommendation (blueprint §9.4), relative to the watched set.
  reason: RecommendationReason;
}

interface ScoredTitle {
  title: Title;
  personalFitScore: number;
  confidenceBand: ConfidenceBand;
  fingerprintCoverage: number;
  reason: RecommendationReason;
}

// null = unknown, never coerced to 0 (blueprint §6, §11.3).
type FingerprintVector = (number | null)[];

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
    @InjectRepository(Title)
    private readonly titlesRepository: Repository<Title>,
    @InjectRepository(UserModelSnapshot)
    private readonly snapshotsRepository: Repository<UserModelSnapshot>,
    @InjectRepository(UserTitleState)
    private readonly statesRepository: Repository<UserTitleState>,
    @InjectRepository(Recommendation)
    private readonly recommendationsRepository: Repository<Recommendation>,
  ) {}

  async findForProfile(userId: string, profileId: string, limit: number): Promise<RecommendationResult[]> {
    const snapshot = await this.loadSnapshot(userId, profileId);

    // Only titles the profile has actually watched leave the candidate pool. A
    // `not_watched` mark means unknown exposure, not a negative signal, so those
    // titles are exactly the recommendation candidates (blueprint §2.4 principle #3).
    const excludedTitleIds = await this.watchedTitleIds(profileId);
    const queryBuilder = this.titlesRepository.createQueryBuilder('title').where('title.fingerprint IS NOT NULL');
    if (excludedTitleIds.length > 0) {
      queryBuilder.andWhere('title.id NOT IN (:...excludedTitleIds)', { excludedTitleIds });
    }
    const titles = await queryBuilder.getMany();

    const results = this.scoreTitles(titles, snapshot)
      .map((scored) => ({
        title: scored.title,
        personalFitScore: scored.personalFitScore,
        publicQualityScore: null,
        watchabilityScore: null,
        confidenceBand: scored.confidenceBand,
        fingerprintCoverage: scored.fingerprintCoverage,
        track: 'safe' as const,
        modelVersion: snapshot.modelVersion,
        reason: scored.reason,
      }))
      .slice(0, limit);

    await this.persistShown(profileId, snapshot.modelVersion, results);
    return results;
  }

  // One row per recommendation actually shown (blueprint §13.1, §14, §14.1) --
  // without this log the post-watch loop (§4.5) can't close and §16 has
  // nothing to read (blueprint gap 4). All rows from one call share a
  // requestId. Left honestly null rather than fabricated: confidenceRaw (no
  // continuous score backs confidenceBand yet, ADR-21), candidateSource
  // (today's full-catalog scan-and-sort matches none of the specified
  // sources -- 'content_similarity' means real similarity retrieval, which
  // this isn't), and experimentId (no experiments exist, blueprint gap 1
  // M4). selectionPropensity is 1: the ranking is deterministic given the
  // snapshot and candidate pool, so every shown item was certain under this
  // policy (the same convention TriadsService uses for its own uniform-random
  // policy, just evaluated for a greedy one).
  private async persistShown(profileId: string, modelVersion: string, results: RecommendationResult[]): Promise<void> {
    if (results.length === 0) {
      return;
    }
    const requestId = randomUUID();
    const shownAt = new Date();
    await this.recommendationsRepository.insert(
      results.map((result) => ({
        requestId,
        profileId,
        titleId: result.title.id,
        track: result.track,
        personalFit: result.personalFitScore,
        publicQuality: result.publicQualityScore,
        watchability: result.watchabilityScore,
        confidenceBand: result.confidenceBand,
        confidenceRaw: null,
        reason: result.reason,
        evidenceSource: result.reason.evidenceSource,
        candidateSource: null,
        modelVersion,
        policyVersion: RECOMMENDATION_POLICY_VERSION,
        experimentId: null,
        selectionPropensity: 1,
        shownAt,
      })) as unknown as QueryDeepPartialEntity<Recommendation>[],
    );
  }

  // The profile's own library ordered by the same model that ranks
  // recommendations (blueprint §5.3 "ترتيب شخصي"). Only watched titles with a
  // fingerprint can be placed; the rest of the library is simply absent here.
  async rankLibrary(userId: string, profileId: string): Promise<LibraryRankingItem[]> {
    const snapshot = await this.loadSnapshot(userId, profileId);

    const watchedTitleIds = await this.watchedTitleIds(profileId);
    if (watchedTitleIds.length === 0) {
      return [];
    }
    const titles = await this.titlesRepository
      .createQueryBuilder('title')
      .where('title.fingerprint IS NOT NULL')
      .andWhere('title.id IN (:...watchedTitleIds)', { watchedTitleIds })
      .getMany();

    return this.scoreTitles(titles, snapshot).map((scored, index) => ({
      title: scored.title,
      position: index + 1,
      confidenceBand: scored.confidenceBand,
      fingerprintCoverage: scored.fingerprintCoverage,
      modelVersion: snapshot.modelVersion,
      reason: scored.reason,
    }));
  }

  // Ownership, then the latest snapshot; both surfaces refuse to guess
  // before a model exists or against a model of the wrong shape.
  private async loadSnapshot(userId: string, profileId: string): Promise<UserModelSnapshot> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const snapshot = await this.snapshotsRepository.findOne({
      where: { profileId },
      order: { createdAt: 'DESC' },
    });
    if (!snapshot) {
      throw new ConflictException('Recommendations are unavailable until the preference model is trained');
    }
    if (snapshot.weights.length !== FINGERPRINT_DIMENSIONS.length) {
      throw new ConflictException('The latest preference model has an incompatible fingerprint dimension');
    }
    return snapshot;
  }

  private async watchedTitleIds(profileId: string): Promise<string[]> {
    const watchedStates = await this.statesRepository.find({
      where: { profileId, state: 'watched' },
      select: { titleId: true },
    });
    return watchedStates.map((state) => state.titleId);
  }

  // Score a set of titles against a snapshot and order them best-fit first.
  // Unknown dimensions are imputed with the mean of this very set (never zero)
  // and cost one confidence band (ADR-19).
  private scoreTitles(titles: Title[], snapshot: UserModelSnapshot): ScoredTitle[] {
    const candidates = titles
      .map((title) => ({ title, vector: this.fingerprintVector(title.fingerprint) }))
      // A fingerprint object with no numeric dimension at all is no fingerprint.
      .filter((candidate) => candidate.vector.some((value) => value !== null));
    const poolMeans = this.poolMeans(candidates.map((candidate) => candidate.vector));
    const baseBand = this.confidenceBand(snapshot);

    return candidates
      .map(({ title, vector }) => {
        const knownCount = vector.filter((value) => value !== null).length;
        const fingerprintCoverage = knownCount / FINGERPRINT_DIMENSIONS.length;
        return {
          title,
          personalFitScore: this.personalFitScore(title, vector, poolMeans, snapshot),
          confidenceBand: fingerprintCoverage < 1 ? BAND_DEMOTION[baseBand] : baseBand,
          fingerprintCoverage,
          reason: this.reason(vector, poolMeans, snapshot),
        };
      })
      .sort((left, right) => right.personalFitScore - left.personalFitScore);
  }

  // The dimensions that actually lifted this title above the pool: the
  // contribution of dimension i is w_i × (φ_i − pool mean_i), so a feature
  // only appears when the user's weight and the title's deviation point the
  // same way (blueprint §9.4 "only from the features that drove the score").
  // Imputed (unknown) dimensions contribute nothing and can never be cited.
  private reason(vector: FingerprintVector, poolMeans: (number | null)[], snapshot: UserModelSnapshot): RecommendationReason {
    const contributions = FINGERPRINT_DIMENSIONS.map((key, index) => {
      const value = vector[index];
      const mean = poolMeans[index];
      if (value === null || mean === null) {
        return { key, contribution: 0 };
      }
      return { key, contribution: snapshot.weights[index] * (value - mean) };
    })
      .filter((entry) => entry.contribution > 0)
      .sort((left, right) => right.contribution - left.contribution);
    const strongest = contributions[0]?.contribution ?? 0;
    const features = contributions
      .filter((entry) => entry.contribution >= strongest * REASON_MIN_SHARE_OF_TOP)
      .slice(0, REASON_MAX_FEATURES)
      .map((entry) => ({
        key: entry.key,
        // A positive weight rewards higher values, a negative one lower ones.
        direction: snapshot.weights[FINGERPRINT_DIMENSIONS.indexOf(entry.key)] > 0 ? ('higher' as const) : ('lower' as const),
      }));
    return { features, evidenceSource: 'individual' };
  }

  // V1 dimensions are flat top-level properties; V2 dimensions are
  // namespaced "family.feature" and live nested under fingerprint.v2.features
  // instead (FINGERPRINT_SCHEMA.md §3.1) -- both are read into one flat
  // 28-value vector here (mirrors training.py's fingerprint_vector()) so
  // nothing past this method needs to know a fingerprint has two different
  // internal shapes. A title enriched with V1 only (no v2 block, true of the
  // original 15 seed titles) simply reports those 15 dimensions as unknown,
  // the same "absence is unknown, not zero" imputation any missing V1
  // dimension already gets (ADR-19) -- scoring tolerates it; only training
  // requires the complete vector.
  private fingerprintVector(fingerprint: Title['fingerprint']): FingerprintVector {
    const v1 = fingerprint as unknown as Record<string, unknown> | null | undefined;
    const v2Features = fingerprint?.v2?.features as Record<string, number> | undefined;
    return FINGERPRINT_DIMENSIONS.map((dimension) => {
      const value = dimension.includes('.') ? v2Features?.[dimension] : v1?.[dimension];
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    });
  }

  // Population mean per dimension over the candidates that know it; null when no
  // candidate knows the dimension.
  private poolMeans(vectors: FingerprintVector[]): (number | null)[] {
    return FINGERPRINT_DIMENSIONS.map((_, index) => {
      const known = vectors.map((vector) => vector[index]).filter((value): value is number => value !== null);
      return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
    });
  }

  private personalFitScore(
    title: Title,
    vector: FingerprintVector,
    poolMeans: (number | null)[],
    snapshot: UserModelSnapshot,
  ): number {
    const weightedScore = vector.reduce<number>((total, value, index) => {
      const effective = value ?? poolMeans[index];
      // A dimension unknown for every candidate contributes nothing for every
      // candidate: neutral for the ordering, and never a fabricated value.
      return effective === null ? total : total + effective * snapshot.weights[index];
    }, 0);
    return weightedScore + (snapshot.biasTerms?.[title.id] ?? 0);
  }

  // Provisional heuristic banding covering four of blueprint §9.2's five
  // criteria: evidence quantity ("عدد أدلة فعال كافٍ"), held-out prediction
  // success, stable posterior direction, and diversity of evidence -- now
  // two of the three named diversity axes, genre and language (gap 5/gap 6).
  // Still NOT the fully calibrated confidence system blueprint §9.3/§16.2
  // describes -- director diversity has no data yet (people/credits/
  // source_records are empty, blueprint gap 6, still open for that one axis),
  // and no Brier/ECE calibration exists (ADR-21). Until then this
  // thresholding is deliberately conservative and must never be presented to
  // the user as a precise probability; it only decides which verbal band
  // copy to show.
  private confidenceBand(snapshot: UserModelSnapshot): ConfidenceBand {
    // Each of these three is NULL below the same 5-triad floor (ADR-31) --
    // below it, every check here is a no-op and banding falls through to the
    // triad-count heuristic alone, same as before gap 5.

    // At or below chance, the evidence is conflicting by definition (§9.3):
    // the model hasn't been shown to predict held-out comparisons at all.
    if (snapshot.heldOutPairwiseAccuracy !== null && snapshot.heldOutPairwiseAccuracy <= HELD_OUT_CHANCE_ACCURACY) {
      return 'inconclusive';
    }

    // No dimension's weight is even one standard error from zero: the
    // model's strongest claimed direction isn't statistically distinguishable
    // from noise under its own fit (BP §9.2 "stable posterior direction").
    if (!this.hasStablePosteriorDirection(snapshot)) {
      return 'inconclusive';
    }

    // Fewer than 2 distinct genres across the training evidence: "one series
    // repeated" by BP §9.2's own phrase, not diverse evidence.
    if (snapshot.trainingGenreDiversity !== null && snapshot.trainingGenreDiversity < MIN_TRAINING_GENRE_DIVERSITY) {
      return 'inconclusive';
    }

    // Same check, the language axis: fewer than 2 distinct original languages
    // across the training evidence.
    if (snapshot.trainingLanguageDiversity !== null && snapshot.trainingLanguageDiversity < MIN_TRAINING_LANGUAGE_DIVERSITY) {
      return 'inconclusive';
    }

    if (snapshot.trainingTriadCount < 3) {
      return 'inconclusive';
    }
    if (snapshot.trainingTriadCount < 10) {
      return 'initial';
    }
    if (snapshot.trainingTriadCount < 20) {
      return 'likely';
    }
    return 'strong';
  }

  private hasStablePosteriorDirection(snapshot: UserModelSnapshot): boolean {
    const standardErrors = snapshot.posterior?.standardErrors;
    if (!standardErrors) {
      return true;
    }
    return snapshot.weights.some((weight, index) => Math.abs(weight) / standardErrors[index] > POSTERIOR_STABILITY_Z);
  }
}
