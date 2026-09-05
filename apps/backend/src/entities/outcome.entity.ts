import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Recommendation } from './recommendation.entity';
import { Triad } from './triad.entity';

// Implicit signals only (BP §13.1) -- never an explicit rating.
export type OutcomeType = 'saved' | 'clicked' | 'opened_provider' | 'dismissed_not_relevant' | 'watched' | 'ranked_later';

@Entity('outcomes')
export class Outcome {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Recommendation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recommendationId' })
  recommendation: Recommendation;

  @Index('IDX_outcomes_recommendationId')
  @Column({ type: 'uuid' })
  recommendationId: string;

  @Column({ type: 'varchar' })
  type: OutcomeType;

  @ManyToOne(() => Triad, { nullable: true })
  @JoinColumn({ name: 'triadId' })
  triad: Triad | null;

  // Set only for 'ranked_later'.
  @Column({ type: 'uuid', nullable: true })
  triadId: string | null;

  // 0..2 within that triad.
  @Column({ type: 'integer', nullable: true })
  rankPosition: number | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  occurredAt: Date;
}
