import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Outcome } from '../../entities/outcome.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Title } from '../../entities/title.entity';
import { WatchEvent } from '../../entities/watch-event.entity';
import { UserTitleStateService } from '../user-title-state/user-title-state.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CreateWatchEventDto } from './dto/create-watch-event.dto';

@Injectable()
export class WatchEventsService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
    @InjectRepository(Title)
    private readonly titlesRepository: Repository<Title>,
    @InjectRepository(Recommendation)
    private readonly recommendationsRepository: Repository<Recommendation>,
    @InjectRepository(WatchEvent)
    private readonly watchEventsRepository: Repository<WatchEvent>,
    @InjectRepository(Outcome)
    private readonly outcomesRepository: Repository<Outcome>,
    private readonly userTitleStateService: UserTitleStateService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // Records a watch instance and, when the title traces back to a shown
  // recommendation, closes BP §4.5's loop: "recommendation shown -> actual
  // watch -> [title returns to triads] -> compare prediction to real ranking
  // -> correct weights/fingerprint". This method closes the first two
  // arrows; the last two already happen on their own once the title is
  // triad-eligible again (TrainingService reads completed triads, not
  // watch_events/outcomes directly) -- nothing here computes a preference
  // value, matching "does not imply liking" (API.md).
  async create(userId: string, profileId: string, dto: CreateWatchEventDto): Promise<WatchEvent> {
    await this.assertProfileOwnership(userId, profileId);
    const title = await this.titlesRepository.findOne({ where: { id: dto.titleId } });
    if (!title) {
      throw new NotFoundException('Title not found');
    }

    const watchedAt = dto.watchedAt ? new Date(dto.watchedAt) : new Date();

    // The most recent recommendation for this exact (profile, title) pair,
    // if any -- "if the title was recommended, links an outcomes row"
    // (API.md). Not scoped to "still shown"/unexpired: a watch can follow a
    // recommendation by any amount of time, and there is no concept of a
    // recommendation expiring today.
    const recommendation = await this.recommendationsRepository.findOne({
      where: { profileId, titleId: dto.titleId },
      order: { createdAt: 'DESC' },
    });

    const watchEvent = await this.watchEventsRepository.save(
      this.watchEventsRepository.create({
        profileId,
        titleId: dto.titleId,
        watchedAt,
        source: dto.source,
        audioLanguage: dto.audioLanguage ?? null,
        subtitleLanguage: dto.subtitleLanguage ?? null,
        provider: dto.provider ?? null,
        recommendationId: recommendation?.id ?? null,
      }),
    );

    // ALPHA_PLAN 7.5's watch signal. `fromRecommendation` is the one number
    // that says whether the loop closed; nothing here records what was
    // watched -- the title id belongs in watch_events, not in a counter.
    await this.analyticsService.record(
      profileId,
      'watch_marked',
      { source: dto.source, fromRecommendation: Boolean(recommendation) },
      watchedAt,
    );

    if (recommendation) {
      await this.outcomesRepository.save(
        this.outcomesRepository.create({
          recommendationId: recommendation.id,
          type: 'watched',
          occurredAt: watchedAt,
        }),
      );
    }

    // "title returns to appropriate triads" (BP §4.5) mechanically means
    // user_title_states.state = 'watched' and triadEligible -- the same
    // state PATCH .../state already sets by hand for imported/self-reported
    // watch history. Reused rather than duplicated (PATCH semantics, M1);
    // this is strictly additive -- .../state keeps working exactly as
    // before for watchlist/interested and for watches with no in-app event.
    await this.userTitleStateService.upsert(userId, profileId, dto.titleId, {
      state: 'watched',
      watchedAt: watchedAt.toISOString(),
    });

    return watchEvent;
  }

  private async assertProfileOwnership(userId: string, profileId: string): Promise<void> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
  }
}
