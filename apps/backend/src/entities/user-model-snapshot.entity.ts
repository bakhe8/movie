import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';

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

  @CreateDateColumn()
  createdAt: Date;
}