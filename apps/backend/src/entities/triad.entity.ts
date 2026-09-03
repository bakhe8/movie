import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn, Index } from 'typeorm';
import { Profile } from './profile.entity';

// At most one active triad per profile -- TriadsService.getCurrent() checks
// for an active triad and creates one when there is none, and without this
// constraint two concurrent requests can both pass that check and both
// insert a row (migration AddOneActiveTriadPerProfileConstraint).
@Index('IDX_triads_one_active_per_profile', ['profileId'], { unique: true, where: "status = 'active'" })
@Entity('triads')
export class Triad {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Column()
  profileId: string;

  @Column('uuid', { array: true })
  titleIds: string[];

  // The order titles were actually shown to the user, kept separate from
  // titleIds so position bias can be measured and corrected for. Nullable
  // because rows created before this field existed have no recorded value.
  @Column('uuid', { array: true, nullable: true })
  displayOrder: string[] | null;

  @Column('integer', { array: true, nullable: true })
  ranking: number[];

  // Which triad-selection policy produced this triad (e.g. 'random-v1').
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

  @Column({ nullable: true })
  sessionId: string;

  @Column({ type: 'json', nullable: true })
  metadata: {
    replacements?: Record<string, string>;
    reasonForSelection?: string;
    modelVersion?: string;
  };

  @Column({ type: 'varchar', default: 'active' })
  status: 'active' | 'completed' | 'skipped';

  @CreateDateColumn()
  createdAt: Date;
}
