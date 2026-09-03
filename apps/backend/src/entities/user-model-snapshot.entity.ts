import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';

@Index('IDX_user_model_snapshots_profileId_createdAt', ['profileId', 'createdAt'])
@Entity('user_model_snapshots')
export class UserModelSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Column()
  profileId: string;

  @Column('real', { array: true })
  weights: number[];

  @Column({ type: 'json', nullable: true })
  biasTerms: Record<string, number>;

  @Column()
  modelVersion: string;

  @Column({ type: 'integer' })
  trainingTriadCount: number;

  @Column('real', { nullable: true })
  validationAccuracy: number;

  // In-sample: computed over every triad used to fit `weights`. Kept for
  // continuity; heldOutPairwiseAccuracy below is the honest out-of-sample
  // version (RANKING_ALGORITHM.md §6, ADR-31).
  @Column('real', { nullable: true })
  pairwiseAccuracy: number;

  // NULL when trainingTriadCount < 5 -- too little data to hold out a
  // meaningful slice, so no held-out metrics are reported at all rather than
  // computed on 0-1 triads (RANKING_ALGORITHM.md §6 step 2).
  @Column({ type: 'integer', nullable: true })
  heldOutTriadCount: number | null;

  @Column('real', { nullable: true })
  heldOutNll: number | null;

  @Column('real', { nullable: true })
  heldOutPairwiseAccuracy: number | null;

  // Per-weight uncertainty (BP §13.1); PlackettLuceRanker.fit() never
  // populates this yet, so it is always NULL today.
  @Column({ type: 'json', nullable: true })
  posterior: Record<string, unknown> | null;

  // Recent-window layer (BP §7.3); NULL in MVP -- no recency weighting exists.
  @Column('real', { array: true, nullable: true })
  recentWeights: number[] | null;

  // [{ titleId, delta, tagged }] (BP §7.4); nothing writes this yet.
  @Column({ type: 'json', nullable: true })
  exceptions: Record<string, unknown> | null;

  // FK to shared_latent_space_versions(version) per SCHEMA.md §2.2 -- that
  // table doesn't exist until M7, so the constraint itself is deferred to
  // that migration (see AddM4ModelVersioningAndExperiments). Plain nullable
  // column until then; nothing writes it either way (no shared latent space
  // version exists to calibrate against).
  @Column({ type: 'varchar', nullable: true })
  calibratedAgainst: string | null;

  @CreateDateColumn()
  createdAt: Date;
}