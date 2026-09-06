import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { Recommendation } from './recommendation.entity';
import { Title } from './title.entity';
import { TitleEdition } from './title-edition.entity';
import { Triad } from './triad.entity';

// BP §6.2, §13.1. Written since 2026-09-03 by WatchEventsService
// (POST /profiles/:profileId/watch-events, ADR-66) alongside
// user_title_states.watchedAt, not instead of it. 'triad_ranked' (ADR-119)
// is internal-only -- CreateWatchEventDto's @IsIn never lists it, so no
// client can claim it; only TriadsService.rank() writes it, once per title
// the first time a triad completes, never guessing a watchedAt.
export type WatchEventSource = 'in_app' | 'import' | 'manual' | 'triad_ranked';

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

  @Index('IDX_watch_events_titleId')
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

  // ADR-119: which triad ranking, if any, is this row's evidence that the
  // title was watched -- only ever set alongside source='triad_ranked'.
  // ON DELETE SET NULL, not CASCADE: this append-only exposure record must
  // outlive the triad row it cites (SCHEMA.md's append-only convention),
  // even though nothing deletes a triad today.
  @ManyToOne(() => Triad, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'triadId' })
  triad: Triad | null;

  @Index('IDX_watch_events_triadId')
  @Column({ type: 'uuid', nullable: true })
  triadId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
