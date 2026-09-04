import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { QueryDeepPartialEntity, Repository } from 'typeorm';
import { ModelVersion } from '../../entities/model-version.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { Triad } from '../../entities/triad.entity';
import { PosterService } from '../public-quality/poster.service';
import { PublicQuality, PublicQualityService } from '../public-quality/public-quality.service';
import { TrainingService } from '../training/training.service';
import { FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS } from '../../entities/title-fingerprint.type';
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
// V1 + V2 (ADR-69) + V3 (ADR-75, FINGERPRINT_SCHEMA.md §3.1/§3.3): 13 + 15 +
// 12 dimensions, in that order -- matches services/workers/src/training.py's
// FINGERPRINT_DIMENSIONS exactly (both trainer and scorer must agree on
// dimension order, since UserModelSnapshot.weights is a plain array
// positioned by this order, not a keyed map).
const FINGERPRINT_DIMENSIONS = [...FINGERPRINT_V1_DIMENSIONS, ...FINGERPRINT_V2_DIMENSIONS, ...FINGERPRINT_V3_DIMENSIONS] as const;

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

// Above chance is not the same as predictive. The first non-synthetic ranker
// (a real human order, DEMO_DATA_PLAN §7.1) landed on 'strong' from its triad
// count alone while predicting only 0.67 of held-out pairs -- the band was
// claiming more than the evidence supported (board C8). Each band a tendency
// is shown under now carries its own held-out floor: 'strong' needs 0.8,
// 'likely' 0.7. The synthetic personas that pass the plan's own bar sit at
// 0.75-1.00, so the floors separate a genuinely predictive model from one
// that is merely better than a coin flip.
const STRONG_MIN_HELD_OUT_ACCURACY = 0.8;
const LIKELY_MIN_HELD_OUT_ACCURACY = 0.7;

// Weakest to strongest; used to take the lower of two bands.
const BAND_ORDER: ConfidenceBand[] = ['inconclusive', 'initial', 'likely', 'strong'];

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
// distinct Title.originalLanguage values across the training triads.
const MIN_TRAINING_LANGUAGE_DIVERSITY = 2;

// Same floor, the third and last of §9.2's three named diversity axes:
// fewer than 2 distinct directors across the training triads. Unblocked by
// blueprint gap 6's director-credit ingestion pass (ADR-70).
const MIN_TRAINING_DIRECTOR_DIVERSITY = 2;

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
  // publicQualityScore is PublicQualityService's own single-source
  // convenience value (`quality.value`) -- non-null only when exactly one
  // displayable source exists, never an average across several (BP §10.3,
  // §4.4's "never merged"). publicQuality carries every source separately
  // for a client that wants to show them individually (G4). watchability
  // still has no data source at all -- explicitly null, never a fabricated
  // number, per the "missing is NULL/unknown, never false or 0" rule
  // (blueprint §11.3).
  publicQualityScore: number | null;
  publicQuality: PublicQuality | null;
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

// Every designed state of GET .../recommendations is a 200 with a
// discriminator, not a 4xx (board B→A): "no model yet" and "paused" are
// product states the screen renders, and a browser logs every 4xx as a
// failed request, so an error status made a clean console impossible.
// 4xx stays for real errors: 401, and 404 for a profile that is not yours.
export type RecommendationsResponse =
  | { state: 'ready'; items: RecommendationResult[] }
  // `needed` counts the rounds still missing before the first training run;
  // 0 means enough rounds were answered and training is on its way.
  | { state: 'pending'; needed: number }
  | { state: 'paused' }
  // A snapshot from before a fingerprint-dimension change (ADR-69/75): it
  // cannot be scored against, and the next training run replaces it.
  | { state: 'model_outdated' };

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
    @InjectRepository(ModelVersion)
    private readonly modelVersionsRepository: Repository<ModelVersion>,
    private readonly publicQualityService: PublicQualityService,
    @InjectRepository(Triad)
    private readonly triadsRepository: Repository<Triad>,
    private readonly trainingService: TrainingService,
    private readonly posterService: PosterService,
  ) {}

  async findForProfile(userId: string, profileId: string, limit: number): Promise<RecommendationsResponse> {
    const outcome = await this.resolveSnapshot(userId, profileId);
    if (outcome.state === 'pending') {
      const completed = await this.triadsRepository.count({ where: { profileId, status: 'completed' } });
      return { state: 'pending', needed: Math.max(0, this.trainingService.firstTriadCount - completed) };
    }
    if (outcome.state !== 'ready') {
      return outcome;
    }
    const snapshot = outcome.snapshot;

    // Only titles the profile has actually watched leave the candidate pool. A
    // `not_watched` mark means unknown exposure, not a negative signal, so those
    // titles are exactly the recommendation candidates (blueprint §2.4 principle #3).
    const excludedTitleIds = await this.watchedTitleIds(profileId);
    const queryBuilder = this.titlesRepository.createQueryBuilder('title').where('title.fingerprint IS NOT NULL');
    if (excludedTitleIds.length > 0) {
      queryBuilder.andWhere('title.id NOT IN (:...excludedTitleIds)', { excludedTitleIds });
    }
    const titles = await queryBuilder.getMany();

    const scored = this.scoreTitles(titles, snapshot).slice(0, limit);
    // Batched over just the titles actually being returned, not the whole
    // candidate pool -- a title absent from the map has no displayable
    // source and gets null, never 0 (BP §11.3).
    const publicQualityByTitle = await this.publicQualityService.forTitles(scored.map((item) => item.title.id));
    const results = scored.map((item) => {
      const publicQuality = publicQualityByTitle.get(item.title.id) ?? null;
      return {
        title: item.title,
        personalFitScore: item.personalFitScore,
        publicQualityScore: publicQuality?.value ?? null,
        publicQuality,
        watchabilityScore: null,
        confidenceBand: item.confidenceBand,
        fingerprintCoverage: item.fingerprintCoverage,
        track: 'safe' as const,
        modelVersion: snapshot.modelVersion,
        reason: item.reason,
      };
    });

    await this.persistShown(profileId, snapshot.modelVersion, results);
    // The poster travels with every title the client renders (ADR-82).
    const posters = await this.posterService.forTitles(results.map((result) => result.title));
    return {
      state: 'ready',
      items: results.map((result) => {
        const poster = posters.get(result.title.id);
        return { ...result, title: { ...result.title, posterUrl: poster?.posterUrl ?? null, posterSource: poster?.posterSource ?? null } };
      }),
    };
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

    const scoredLibrary = this.scoreTitles(titles, snapshot);
    const libraryPosters = await this.posterService.forTitles(scoredLibrary.map((scored) => scored.title));
    return scoredLibrary.map((scored, index) => ({
      title: (() => {
        const poster = libraryPosters.get(scored.title.id);
        return { ...scored.title, posterUrl: poster?.posterUrl ?? null, posterSource: poster?.posterSource ?? null };
      })(),
      position: index + 1,
      confidenceBand: scored.confidenceBand,
      fingerprintCoverage: scored.fingerprintCoverage,
      modelVersion: snapshot.modelVersion,
      reason: scored.reason,
    }));
  }

  // Ownership, then the served snapshot; both surfaces refuse to guess
  // before a model exists or against a model of the wrong shape.
  //
  // model_versions.active pins the version an admin wants served (BP §18.1's
  // rollback control) -- AdminModelsService already enforces at most one
  // active row, but until now nothing read it back, so activating a version
  // had no effect on what was actually served (F10). When a version is
  // pinned, prefer this profile's latest snapshot trained under that exact
  // modelVersion; a profile with no snapshot under the pinned version (never
  // retrained since the pin, or the pin points at a version this profile
  // hasn't reached yet) falls back to its own latest snapshot regardless of
  // version, same as when nothing is pinned at all -- a rollback narrows
  // which snapshot is preferred, it never turns a servable profile into an
  // unservable one.
  private async loadSnapshot(userId: string, profileId: string): Promise<UserModelSnapshot> {
    const outcome = await this.resolveSnapshot(userId, profileId);
    if (outcome.state === 'ready') {
      return outcome.snapshot;
    }
    // rankLibrary() keeps the older error contract; only the recommendations
    // route was asked to move to states (board B→A).
    if (outcome.state === 'paused') {
      throw new ConflictException({ statusCode: 409, message: 'This profile is paused', error: 'Conflict', reason: 'profile_paused' });
    }
    if (outcome.state === 'model_outdated') {
      throw new ConflictException('The latest preference model has an incompatible fingerprint dimension');
    }
    throw new ConflictException('Recommendations are unavailable until the preference model is trained');
  }

  private async resolveSnapshot(
    userId: string,
    profileId: string,
  ): Promise<{ state: 'ready'; snapshot: UserModelSnapshot } | { state: 'pending' } | { state: 'paused' } | { state: 'model_outdated' }> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    // PRIVACY.md §4's `pause_all`: training already refuses a paused profile
    // (TrainingService); serving predictions from the model it stopped
    // updating is the other half of "training and recommendations stop".
    // Nothing is deleted, so this is reversible by resuming.
    if (profile.pausedAt) {
      return { state: 'paused' };
    }

    const activeVersion = await this.modelVersionsRepository.findOne({ where: { active: true } });
    let snapshot: UserModelSnapshot | null = null;
    if (activeVersion) {
      snapshot = await this.snapshotsRepository.findOne({
        where: { profileId, modelVersion: activeVersion.version },
        order: { createdAt: 'DESC' },
      });
    }
    if (!snapshot) {
      snapshot = await this.snapshotsRepository.findOne({
        where: { profileId },
        order: { createdAt: 'DESC' },
      });
    }
    if (!snapshot) {
      return { state: 'pending' };
    }
    if (snapshot.weights.length !== FINGERPRINT_DIMENSIONS.length) {
      return { state: 'model_outdated' };
    }
    return { state: 'ready', snapshot };
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

  // V1 dimensions are flat top-level properties; V2 and V3 dimensions are
  // namespaced "family.feature" and live nested under fingerprint.v2.features
  // and fingerprint.v3.features respectively (FINGERPRINT_SCHEMA.md
  // §3.1/§3.3) -- all three are read into one flat 40-value vector here
  // (mirrors training.py's fingerprint_vector()) so nothing past this method
  // needs to know a fingerprint has three different internal shapes. V2 and
  // V3 family names never collide, so a namespaced key is read from V3's
  // block only when it is actually one of V3's own keys, V2's otherwise. A
  // title enriched with V1 (+V2) only (no v3 block, true of the original 15
  // seed titles neither enrichment pass has touched) simply reports those 12
  // dimensions as unknown, the same "absence is unknown, not zero"
  // imputation any missing V1 dimension already gets (ADR-19) -- scoring
  // tolerates it; only training requires the complete vector.
  private fingerprintVector(fingerprint: Title['fingerprint']): FingerprintVector {
    const v1 = fingerprint as unknown as Record<string, unknown> | null | undefined;
    const v2Features = fingerprint?.v2?.features as Record<string, number> | undefined;
    const v3Features = fingerprint?.v3?.features as Record<string, number> | undefined;
    return FINGERPRINT_DIMENSIONS.map((dimension) => {
      const value = !dimension.includes('.')
        ? v1?.[dimension]
        : (FINGERPRINT_V3_DIMENSIONS as readonly string[]).includes(dimension)
          ? v3Features?.[dimension]
          : v2Features?.[dimension];
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

  // Heuristic banding covering all of blueprint §9.2's diversity-related
  // criteria: evidence quantity ("عدد أدلة فعال كافٍ"), held-out prediction
  // success, stable posterior direction, and diversity of evidence -- all
  // three named axes now wired: genre (ADR-62), language (ADR-64) and
  // director (ADR-71, unblocked by gap 6's ingestion pass, ADR-70). Still
  // NOT the fully calibrated confidence system blueprint §9.3/§16.2
  // describes -- no Brier/ECE calibration exists (ADR-21). Until then this
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

    // The floors below cap whatever the rest of this method concludes: no
    // amount of triad count, diversity or posterior stability makes a band
    // the held-out accuracy does not support (C8).
    const ceiling = this.heldOutAccuracyCeiling(snapshot);

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

    // Same check, the third and last named axis: fewer than 2 distinct
    // directors across the training evidence.
    if (snapshot.trainingDirectorDiversity !== null && snapshot.trainingDirectorDiversity < MIN_TRAINING_DIRECTOR_DIVERSITY) {
      return 'inconclusive';
    }

    if (snapshot.trainingTriadCount < 3) {
      return 'inconclusive';
    }
    const fromTriadCount: ConfidenceBand =
      snapshot.trainingTriadCount < 10 ? 'initial' : snapshot.trainingTriadCount < 20 ? 'likely' : 'strong';
    return BAND_ORDER.indexOf(ceiling) < BAND_ORDER.indexOf(fromTriadCount) ? ceiling : fromTriadCount;
  }

  // The highest band this snapshot's held-out accuracy supports. Unknown
  // accuracy (below the 5-triad floor, ADR-31) caps nothing, exactly like
  // every other held-out-gated check here.
  private heldOutAccuracyCeiling(snapshot: UserModelSnapshot): ConfidenceBand {
    const accuracy = snapshot.heldOutPairwiseAccuracy;
    if (accuracy === null || accuracy === undefined) {
      return 'strong';
    }
    if (accuracy >= STRONG_MIN_HELD_OUT_ACCURACY) {
      return 'strong';
    }
    return accuracy >= LIKELY_MIN_HELD_OUT_ACCURACY ? 'likely' : 'initial';
  }

  private hasStablePosteriorDirection(snapshot: UserModelSnapshot): boolean {
    const standardErrors = snapshot.posterior?.standardErrors;
    if (!standardErrors) {
      return true;
    }
    return snapshot.weights.some((weight, index) => Math.abs(weight) / standardErrors[index] > POSTERIOR_STABILITY_Z);
  }
}
