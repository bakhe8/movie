import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';

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
] as const;

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

    return this.scoreTitles(titles, snapshot)
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

  private fingerprintVector(fingerprint: Title['fingerprint']): FingerprintVector {
    return FINGERPRINT_DIMENSIONS.map((dimension) => {
      const value = fingerprint?.[dimension];
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

  // Provisional heuristic banding by evidence quantity (blueprint §9.2's first
  // criterion: "عدد أدلة فعال كافٍ"). This is NOT the calibrated confidence system
  // blueprint §9.3/§16.2 describes (which also requires context diversity and
  // successful prediction of held-out comparisons, validated via Brier score/ECE)
  // -- that calibration work hasn't been done yet (ADR-21). Until it has, this
  // thresholding is deliberately conservative and must never be presented to the
  // user as a precise probability; it only decides which verbal band copy to show.
  private confidenceBand(snapshot: UserModelSnapshot): ConfidenceBand {
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
}
