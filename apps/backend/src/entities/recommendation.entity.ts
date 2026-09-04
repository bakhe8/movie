import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { Title } from './title.entity';

// One row per recommendation actually shown (BP §13.1, §14, §14.1). Written
// since 2026-09-03 by RecommendationsService.findForProfile() (ADR-58) and
// read back by WatchEventsService to close the post-watch loop (BP §4.5,
// ADR-66): a watch event links to the most recent recommendation for the
// same (profile, title), if any.
export type RecommendationTrack = 'safe' | 'discovery' | 'outside_usual';

@Entity('recommendations')
export class Recommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  requestId: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Index('IDX_recommendations_profileId_createdAt')
  @Column({ type: 'uuid' })
  profileId: string;

  @ManyToOne(() => Title)
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Index('IDX_recommendations_titleId')
  @Column({ type: 'uuid' })
  titleId: string;

  @Column({ type: 'varchar' })
  track: RecommendationTrack;

  // Never merged into one score -- BP §4.4 keeps personal fit, public
  // quality and watchability separate all the way to display.
  @Column({ type: 'real', nullable: true })
  personalFit: number | null;

  @Column({ type: 'real', nullable: true })
  publicQuality: number | null;

  @Column({ type: 'real', nullable: true })
  watchability: number | null;

  @Column()
  confidenceBand: string;

  // Internal until calibrated (BP §7.2) -- never shown to the user directly.
  @Column({ type: 'real', nullable: true })
  confidenceRaw: number | null;

  @Column({ type: 'json' })
  reason: Record<string, unknown>;

  @Column({ default: 'individual' })
  evidenceSource: string;

  @Column({ type: 'varchar', nullable: true })
  candidateSource: string | null;

  @Column()
  modelVersion: string;

  @Column()
  policyVersion: string;

  @Column({ type: 'varchar', nullable: true })
  experimentId: string | null;

  @Column({ type: 'real', nullable: true })
  selectionPropensity: number | null;

  @Column({ type: 'timestamp', nullable: true })
  shownAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
