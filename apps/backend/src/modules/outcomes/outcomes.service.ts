import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { CreateOutcomeDto } from './dto/create-outcome.dto';

@Injectable()
export class OutcomesService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
    @InjectRepository(Recommendation)
    private readonly recommendationsRepository: Repository<Recommendation>,
    @InjectRepository(Outcome)
    private readonly outcomesRepository: Repository<Outcome>,
  ) {}

  // BP §13.1's implicit-signal outcomes -- 'saved'/'clicked'/
  // 'dismissed_not_relevant'/'opened_provider' only (CreateOutcomeDto), an
  // append-only event log like triad_replacements, not a toggle: acting
  // twice on the same recommendation writes two rows, both real events.
  // Ownership is via the recommendation's own profileId, the same pattern
  // TriadsService.rank() uses for a triad id with no profileId in the URL.
  async create(userId: string, recommendationId: string, dto: CreateOutcomeDto): Promise<Outcome> {
    const recommendation = await this.recommendationsRepository.findOne({ where: { id: recommendationId } });
    if (!recommendation) {
      throw new NotFoundException('Recommendation not found');
    }
    await this.assertProfileOwnership(userId, recommendation.profileId);

    return this.outcomesRepository.save(
      this.outcomesRepository.create({
        recommendationId,
        type: dto.type,
        occurredAt: new Date(),
      }),
    );
  }

  private async assertProfileOwnership(userId: string, profileId: string): Promise<void> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
  }
}
