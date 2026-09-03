import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { Title } from './title.entity';

// One row per recommendation actually shown (BP §13.1, §14, §14.1). Without
// this, the post-watch loop (BP §4.5) has nothing to close and BP §16 has
// nothing to read -- blueprint gap 4. Schema only for now: nothing writes a
// row here yet, RecommendationsService still computes scores per-request.
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
