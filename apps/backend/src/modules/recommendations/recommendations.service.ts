import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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

// Personal Fit, Public Quality, and Watchability are always three separate values,
// never merged into one number, and confidence is a verbal band rather than a raw
// percentage until it has been calibrated against confirmed post-watch outcomes
// (blueprint §4.4, §7.2, §9.3; docs/schema.md's `recommendations` table).
export interface RecommendationResult {
  title: Title;
  personalFitScore: number;
  // Neither has a data source yet (no critic/audience-prior ingestion, no
  // availability/JustWatch integration) -- explicitly null, never a fabricated
  // number, per the "missing is NULL/unknown, never false or 0" rule (blueprint §11.3).
  publicQualityScore: number | null;
  watchabilityScore: number | null;
  confidenceBand: ConfidenceBand;
  // Every result is 'safe' today -- there is no discovery/outside-usual selection
  // policy implemented yet (blueprint §4.4, §8). Not fabricated, just not built.
  track: RecommendationTrack;
  modelVersion: string;
}

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

    const excludedStates = await this.statesRepository.find({
      where: { profileId, state: In(['watched', 'not_watched']) },
      select: { titleId: true },
    });
    const excludedTitleIds = excludedStates.map((state) => state.titleId);
    const queryBuilder = this.titlesRepository.createQueryBuilder('title').where('title.fingerprint IS NOT NULL');
    if (excludedTitleIds.length > 0) {
      queryBuilder.andWhere('title.id NOT IN (:...excludedTitleIds)', { excludedTitleIds });
    }
    const titles = await queryBuilder.getMany();

    const confidenceBand = this.confidenceBand(snapshot);

    return titles
      .map((title) => ({
        title,
        personalFitScore: this.personalFitScore(title, snapshot),
        publicQualityScore: null,
        watchabilityScore: null,
        confidenceBand,
        track: 'safe' as const,
        modelVersion: snapshot.modelVersion,
      }))
      .sort((left, right) => right.personalFitScore - left.personalFitScore)
      .slice(0, limit);
  }

  private personalFitScore(title: Title, snapshot: UserModelSnapshot): number {
    const fingerprint = title.fingerprint;
    const weightedScore = FINGERPRINT_DIMENSIONS.reduce(
      (total, dimension, index) => total + (Number(fingerprint?.[dimension]) || 0) * snapshot.weights[index],
      0,
    );
    return weightedScore + (snapshot.biasTerms?.[title.id] ?? 0);
  }

  // Provisional heuristic banding by evidence quantity (blueprint §9.2's first
  // criterion: "عدد أدلة فعال كافٍ"). This is NOT the calibrated confidence system
  // blueprint §9.3/§16.2 describes (which also requires context diversity and
  // successful prediction of held-out comparisons, validated via Brier score/ECE)
  // -- that calibration work hasn't been done yet. Until it has, this thresholding
  // is deliberately conservative and must never be presented to the user as a
  // precise probability; it only decides which verbal band copy to show.
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