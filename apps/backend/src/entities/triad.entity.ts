import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn, Index } from 'typeorm';
import type { TriadPurpose } from '../modules/triads/triad-set';
import { Profile } from './profile.entity';

// At most one active triad per profile -- TriadsService.getCurrent() checks
// for an active triad and creates one when there is none, and without this
// constraint two concurrent requests can both pass that check and both
// insert a row (migration AddOneActiveTriadPerProfileConstraint).
@Index('IDX_triads_one_active_per_profile', ['profileId'], { unique: true, where: "status = 'active'" })
@Index('IDX_triads_profileId_createdAt', ['profileId', 'createdAt'])
@Index('IDX_triads_profileId_status', ['profileId', 'status'])
@Index('IDX_triads_profileId_setHash', ['profileId', 'setHash'])
@Entity('triads')
export class Triad {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Column({ type: 'uuid' })
  profileId: string;

  @Column('uuid', { array: true })
  titleIds: string[];

  // The order titles were actually shown to the user, kept separate from
  // titleIds so position bias can be measured and corrected for. Nullable
  // because rows created before this field existed have no recorded value.
  @Column('uuid', { array: true, nullable: true })
  displayOrder: string[] | null;

  // The set of three as one key (ADR-99, modules/triads/triad-set.ts): equal
  // for every permutation of the same films, so the selection policy can
  // tell a repeat from a new question. NULL only on rows older than the
  // column; the AddTriadSetHashAndPurpose migration backfills every row.
  @Column({ type: 'varchar', length: 32, nullable: true })
  setHash: string | null;

  // 'learn' = new evidence; 'verify' = a set this profile already completed,
  // re-asked because no unseen set was left (ADR-99). Verify rounds measure
  // consistency: they count toward neither the training threshold nor the
  // rounds shown to the user, and the trainer leaves them out.
  @Column({ type: 'varchar', default: 'learn' })
  purpose: TriadPurpose;

  // Derived from purpose today (verify = false); its own column because a
  // future purpose (bridge/boundary/explore, BP §8.1) may count again.
  @Column({ type: 'boolean', default: true })
  countsTowardActivation: boolean;

  // Title ids in ranked order, best-liked first -- not indices into
  // titleIds (ADR-15). TriadsService validates this is exactly the
  // triad's own three title ids before it is ever written.
  @Column('uuid', { array: true, nullable: true })
  ranking: string[] | null;

  // Set once, when the triad is created (TriadsService.getCurrent()).
  @Column({ type: 'timestamp', nullable: true })
  shownAt: Date | null;

  // Set once, when TriadsService.rank() records the submitted ranking.
  // NULL for triads completed before this column existed (unknown, not
  // backfilled with a fabricated timestamp).
  @Column({ type: 'timestamp', nullable: true })
  answeredAt: Date | null;

  // Which trained model snapshot (if any) selected this triad. NULL for the
  // random policy (random-v2, ADR-99), which uses no model -- honest "no
  // model", never a fabricated version string (blueprint §11.3).
  @Column({ type: 'varchar', nullable: true })
  modelVersion: string | null;

  // Client-generated key so a retried POST /triads/:id/rank is safe
  // (blueprint §14, ADR-15). Unique across every triad: a client mints a
  // fresh key per logical submission attempt, never reusing one for a
  // different triad.
  @Column({ type: 'uuid', nullable: true, unique: true })
  idempotencyKey: string | null;

  // Which triad-selection policy produced this triad (e.g. 'random-v2').
  // Bumped whenever the selection policy changes so past triads stay
  // attributable to the policy that actually generated them.
  @Column({ type: 'varchar', nullable: true })
  policyVersion: string | null;

  // Probability the selection policy would have produced this exact triad,
  // used to de-bias offline evaluation of adaptive policies later. NULL
  // means unrecorded (legacy rows), not "certain".
  @Column({ type: 'real', nullable: true })
  selectionPropensity: number | null;

  // Reserved for when a running experiment produced this triad. NULL until
  // experiments exist.
  @Column({ type: 'varchar', nullable: true })
  experimentId: string | null;

  @Column({ type: 'varchar', nullable: true })
  sessionId: string;

  @Column({ type: 'json', nullable: true })
  metadata: {
    replacements?: Record<string, string>;
    reasonForSelection?: string;
  };

  @Column({ type: 'varchar', default: 'active' })
  status: 'active' | 'completed' | 'skipped';

  // Append-only correction (blueprint §13.2): points at the triad this one
  // corrects, instead of ever updating that triad's own row. NULL for every
  // triad today -- no correction flow is built yet (M1, SCHEMA.md §2.4).
  // The relation the M1 DDL carries (FK_triads_correctsTriadId, NO ACTION):
  // declared so the entity describes the constraint that exists, instead of
  // TypeORM proposing to drop it on every schema comparison (ADR-91).
  @ManyToOne(() => Triad, { nullable: true })
  @JoinColumn({ name: 'correctsTriadId' })
  correctsTriad: Triad | null;

  @Column({ type: 'uuid', nullable: true })
  correctsTriadId: string | null;

  // Reserved for a held-out validation split decided by the selection
  // policy at creation time (blueprint §8.3, §16.1) -- never trained on.
  // Always false today: the random policy has no holdout concept of its own: it's
  // training.py's temporal split (ADR-31) that reserves data for
  // evaluation, not this per-triad flag.
  @Column({ type: 'boolean', default: false })
  holdout: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
