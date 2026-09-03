import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { SharedLatentSpaceVersion } from './shared-latent-space-version.entity';

// Per-weight uncertainty (BP §13.1, blueprint gap 5's "stable posterior
// direction" criterion, BP §9.2). standardErrors[i] is the Laplace/BFGS
// approximation to weights[i]'s standard error -- sqrt(diag(hess_inv)) from
// the same regularized-MLE fit that produced `weights` (services/workers's
// ranker.py); the L2 term makes this a MAP estimate under a Gaussian prior,
// so the inverse Hessian at the optimum is the standard Laplace
// approximation to the posterior covariance, not an invented statistic.
export interface UserModelSnapshotPosterior {
  standardErrors: number[];
}

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

  // See UserModelSnapshotPosterior above. NULL when trainingTriadCount < 5,
  // the same floor heldOutTriadCount uses (ADR-31): a standard error from a
  // handful of triads is too unstable to report as evidence either way.
  @Column({ type: 'json', nullable: true })
  posterior: UserModelSnapshotPosterior | null;

  // Recent-window layer (BP §7.3); NULL in MVP -- no recency weighting exists.
  @Column('real', { array: true, nullable: true })
  recentWeights: number[] | null;

  // [{ titleId, delta, tagged }] (BP §7.4); nothing writes this yet.
  @Column({ type: 'json', nullable: true })
  exceptions: Record<string, unknown> | null;

  // FK to shared_latent_space_versions(version), added in M7
  // (AddM7SharedLatentSpaceVersions) once that table existed -- M4 added
  // the column itself first (ADR-54) since it predates the table by three
  // steps. Nothing writes this yet; no shared latent space version exists
  // to calibrate against.
  @ManyToOne(() => SharedLatentSpaceVersion, { nullable: true })
  @JoinColumn({ name: 'calibratedAgainst' })
  calibratedAgainstVersion: SharedLatentSpaceVersion | null;

  @Column({ type: 'varchar', nullable: true })
  calibratedAgainst: string | null;

  // Distinct genre count across the titles in the triads this snapshot was
  // trained on (blueprint gap 5, BP §9.2's "sufficient effective evidence
  // (not one series repeated)" and "diversity of ... genres" read together).
  // NULL for snapshots trained before this column existed.
  @Column({ type: 'integer', nullable: true })
  trainingGenreDiversity: number | null;

  // Same idea, the second of §9.2's three named diversity axes: distinct
  // Title.originalLanguage count across the triads this snapshot was trained
  // on. The third axis (director) still has no data -- people/credits/
  // source_records stay empty until a real ingestion pass runs (blueprint
  // gap 6). NULL for snapshots trained before this column existed.
  @Column({ type: 'integer', nullable: true })
  trainingLanguageDiversity: number | null;

  @CreateDateColumn()
  createdAt: Date;
}