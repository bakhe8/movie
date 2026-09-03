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

export interface RecommendationResult {
  title: Title;
  score: number;
  confidence: number;
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

    return titles
      .map((title) => ({
        title,
        score: this.score(title, snapshot),
        confidence: snapshot.pairwiseAccuracy ?? 0,
        modelVersion: snapshot.modelVersion,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  private score(title: Title, snapshot: UserModelSnapshot): number {
    const fingerprint = title.fingerprint;
    const weightedScore = FINGERPRINT_DIMENSIONS.reduce(
      (total, dimension, index) => total + (Number(fingerprint?.[dimension]) || 0) * snapshot.weights[index],
      0,
    );
    return weightedScore + (snapshot.biasTerms?.[title.id] ?? 0);
  }
}