import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsEvent, type AnalyticsEventName } from '../../entities/analytics-event.entity';
import { Consent } from '../../entities/consent.entity';
import { Profile } from '../../entities/profile.entity';

// Values a property may hold. Anything else is dropped rather than coerced:
// an object or an array is how free-form text and ids sneak into an analytics
// table, and once written they are in every backup.
export type AnalyticsProperties = Record<string, number | string | boolean>;

// A string property is an enum-ish tag ('rank', 'skip'), never prose. Longer
// than this and it is something else, so it is dropped.
const MAX_STRING_PROPERTY = 32;
const MAX_PROPERTIES = 12;
// How far back a client may date an event it reports. Long enough for a round
// finished offline and synced later, short enough that a wrong device clock
// cannot backdate rows into a period that has already been reported on.
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(AnalyticsEvent)
    private readonly eventsRepository: Repository<AnalyticsEvent>,
    @InjectRepository(Consent)
    private readonly consentsRepository: Repository<Consent>,
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
  ) {}

  // Records one event, or does nothing. It never throws and never delays what
  // it is measuring: analytics that can fail a rank, or make it slower, would
  // be worse than no analytics (BP §13).
  async record(
    profileId: string | null,
    name: AnalyticsEventName,
    properties: AnalyticsProperties = {},
    occurredAt: Date = new Date(),
  ): Promise<void> {
    try {
      if (profileId && !(await this.consented(profileId))) {
        return;
      }
      await this.eventsRepository.insert({
        profileId,
        name,
        occurredAt: this.clamp(occurredAt),
        properties: this.sanitise(properties),
      });
    } catch (error) {
      this.logger.warn(`analytics event ${name} not recorded: ${error instanceof Error ? error.message : error}`);
    }
  }

  // PRIVACY.md §3: `analytics_first_party` is an opt-in purpose, so silence
  // means no. An event with no profile behind it (an anonymous funnel step
  // before sign-up) has no consent to check and no profile to identify.
  private async consented(profileId: string): Promise<boolean> {
    const profile = await this.profilesRepository.findOne({
      where: { id: profileId },
      select: { id: true, userId: true },
    });
    if (!profile) {
      return false;
    }
    const consent = await this.consentsRepository.findOne({
      where: { userId: profile.userId, purpose: 'analytics_first_party' },
      order: { grantedAt: 'DESC' },
    });
    return consent?.granted === true && consent.revokedAt === null;
  }

  // `occurredAt` can come from a client's own clock. A future timestamp or
  // one older than the backdating window is replaced by now rather than
  // rejected: the event still happened, and losing a count is worse than a
  // slightly wrong one -- but a wrong clock must not write into a window that
  // has already been reported on.
  private clamp(occurredAt: Date): Date {
    const now = new Date();
    const value = occurredAt.getTime();
    if (!Number.isFinite(value) || value > now.getTime() || now.getTime() - value > MAX_BACKDATE_MS) {
      return now;
    }
    return occurredAt;
  }

  private sanitise(properties: AnalyticsProperties): AnalyticsProperties {
    const clean: AnalyticsProperties = {};
    for (const [key, value] of Object.entries(properties)) {
      if (Object.keys(clean).length >= MAX_PROPERTIES) {
        break;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        clean[key] = value;
      } else if (typeof value === 'boolean') {
        clean[key] = value;
      } else if (typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_PROPERTY) {
        clean[key] = value;
      }
    }
    return clean;
  }
}
