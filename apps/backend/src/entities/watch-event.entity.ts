import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { Recommendation } from './recommendation.entity';
import { Title } from './title.entity';
import { TitleEdition } from './title-edition.entity';

// BP §6.2, §13.1. Written since 2026-09-03 by WatchEventsService
// (POST /profiles/:profileId/watch-events, ADR-66) alongside
// user_title_states.watchedAt, not instead of it.
export type WatchEventSource = 'in_app' | 'import' | 'manual';

@Entity('watch_events')
export class WatchEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Index('IDX_watch_events_profileId')
  @Column({ type: 'uuid' })
  profileId: string;

  @ManyToOne(() => Title)
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Column({ type: 'uuid' })
  titleId: string;

  @Column({ type: 'timestamp', nullable: true })
  watchedAt: Date | null;

  @Column({ type: 'varchar' })
  source: WatchEventSource;

  @ManyToOne(() => TitleEdition, { nullable: true })
  @JoinColumn({ name: 'editionId' })
  edition: TitleEdition | null;

  @Column({ type: 'uuid', nullable: true })
  editionId: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  audioLanguage: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  subtitleLanguage: string | null;

  @Column({ type: 'varchar', nullable: true })
  provider: string | null;

  // No FK per SCHEMA.md §2.2's target DDL, even though library_imports
  // exists (matches the target literally rather than inventing a stricter
  // constraint the plan doesn't specify).
  @Column({ type: 'uuid', nullable: true })
  importId: string | null;

  // Closes the loop (BP §4.5): which recommendation, if any, led to this watch.
  @ManyToOne(() => Recommendation, { nullable: true })
  @JoinColumn({ name: 'recommendationId' })
  recommendation: Recommendation | null;

  @Index('IDX_watch_events_recommendationId')
  @Column({ type: 'uuid', nullable: true })
  recommendationId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
