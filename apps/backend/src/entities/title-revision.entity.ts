import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Title } from './title.entity';

// PUB-S1 (ADR-118): one immutable content snapshot per accepted change,
// carrying the public-v1 evaluation that decided whether it may ever be
// pointed at by `titles.publishedRevisionId`. Never updated in place -- a
// correction is a new row, same discipline as `source_records` (BP §11.3).
//
// Registered in `DatabaseConfig`, but nothing writes a row here yet: the
// shadow evaluator (PUB-S1) previews readiness against a title's current
// columns, not a snapshot. Board 1D-9 (manual publish) is the first writer,
// by owner decision 2026-09-06 -- no bootstrap or other mechanism may set
// `titles.publishedRevisionId` before that gate opens.
@Entity('title_revisions')
export class TitleRevision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Column({ type: 'uuid' })
  titleId: string;

  @Column({ type: 'varchar' })
  titleEn: string;

  @Column({ type: 'varchar' })
  titleAr: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  /** TMDB's own path (`/abc123.jpg`), never a composed URL -- ADR-82. */
  @Column({ type: 'varchar', nullable: true })
  posterPath: string | null;

  @Column({ type: 'text', nullable: true })
  genres: string | null;

  @Column({ type: 'integer', nullable: true })
  releaseYear: number | null;

  /** `source_records` rows this snapshot's fields were built from. */
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  sourceRecordIds: string[];

  /** The policy version evaluated against this snapshot, e.g. `'public-v1'`. */
  @Column({ type: 'varchar' })
  policyVersion: string;

  /** Empty only when the policy accepted the snapshot (ADR-118). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  blockerCodes: string[];

  @Column({ type: 'timestamp' })
  evaluatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
