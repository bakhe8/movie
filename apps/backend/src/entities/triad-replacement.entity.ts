import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Title } from './title.entity';
import { Triad } from './triad.entity';

// The two neutral reasons a user can give for swapping a triad item
// (blueprint §4.3, ADR-17). Deliberately distinct: `not_watched` clears
// exposure (the title stays a recommendation candidate and leaves the triad
// pool), `not_remembered` keeps the watch (not recommendable) but removes
// the title from the triad pool via UserTitleState.triadEligible.
export const REPLACEMENT_REASONS = ['not_watched', 'not_remembered'] as const;
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number];

// One row per replacement on a triad -- append-only (SCHEMA.md §2.3). It
// records that the user said "haven't watched" or "don't remember" about
// replacedTitleId and which title took its slot; replacementTitleId is NULL
// when the eligible pool had nothing left (or the per-triad replacement
// limit was exceeded) and the triad was marked `skipped` instead.
//
// Neither reason is a preference signal: nothing here enters training, a
// prior or a score (SPECIFICATION.md §2 row 3). Replacement rate is a
// Phase 0/Alpha metric (BP §17.1, §21.2).
@Entity('triad_replacements')
export class TriadReplacement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Triad, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'triadId', foreignKeyConstraintName: 'FK_triad_replacements_triadId' })
  triad: Triad;

  @Index('IDX_triad_replacements_triadId')
  @Column({ type: 'uuid' })
  triadId: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'replacedTitleId', foreignKeyConstraintName: 'FK_triad_replacements_replacedTitleId' })
  replacedTitle: Title;

  @Column({ type: 'uuid' })
  replacedTitleId: string;

  @ManyToOne(() => Title, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'replacementTitleId', foreignKeyConstraintName: 'FK_triad_replacements_replacementTitleId' })
  replacementTitle: Title | null;

  @Column({ type: 'uuid', nullable: true })
  replacementTitleId: string | null;

  @Column({ type: 'varchar' })
  reason: ReplacementReason;

  @CreateDateColumn()
  createdAt: Date;
}
