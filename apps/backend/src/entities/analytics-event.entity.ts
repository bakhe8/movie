import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';

// ALPHA_PLAN 7.5 / BP §13: product analytics in a first-party table, never a
// third-party pixel. The closed list is the point -- an open `name` column
// would let any caller invent an event, and the properties column would drift
// into a PII sink. Adding an event means adding it here, on purpose.
export type AnalyticsEventName =
  // Onboarding funnel (BP §4.1-4.2): which step a profile reached.
  | 'onboarding_started'
  | 'onboarding_consents_answered'
  | 'onboarding_market_chosen'
  | 'onboarding_titles_marked'
  | 'onboarding_completed'
  // Triad round (BP §4.3): how long a round took, and whether it was answered.
  | 'triad_shown'
  | 'triad_answered'
  | 'triad_replaced'
  // Post-recommendation (BP §4.4-4.5): the click and the watch.
  | 'recommendation_opened'
  | 'watch_marked';

export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = [
  'onboarding_started',
  'onboarding_consents_answered',
  'onboarding_market_chosen',
  'onboarding_titles_marked',
  'onboarding_completed',
  'triad_shown',
  'triad_answered',
  'triad_replaced',
  'recommendation_opened',
  'watch_marked',
];

@Entity('analytics_events')
@Index('IDX_analytics_events_name_occurredAt', ['name', 'occurredAt'])
@Index('IDX_analytics_events_profileId_occurredAt', ['profileId', 'occurredAt'])
export class AnalyticsEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // SET NULL like consents and privacy_requests (ADR-80): a deleted profile
  // must not take the counts with it, and the row keeps no way back to a
  // person once the profile is gone.
  @ManyToOne(() => Profile, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'profileId' })
  profile: Profile | null;

  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  @Column({ type: 'varchar', length: 64 })
  name: AnalyticsEventName;

  // When it happened, which is not when it was written: a client can report a
  // round it finished while offline.
  @Column({ type: 'timestamp' })
  occurredAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  // Numbers and short enums only -- see AnalyticsService, which strips
  // anything else before this row is built. Never free text, never an id
  // belonging to a person.
  // Stated without the ::jsonb cast: TypeORM strips casts when it reads a
  // default back from Postgres, so the cast form never compared equal and
  // schema:log proposed re-setting this default on every run.
  @Column({ type: 'jsonb', default: () => "'{}'" })
  properties: Record<string, number | string | boolean>;
}
