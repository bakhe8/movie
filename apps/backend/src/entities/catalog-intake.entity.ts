import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Title } from './title.entity';

// CAT-J1 / ADR-121: a candidate work a source adapter discovered, held
// OUTSIDE `titles` until a human admits it. Identity here is the provider
// ids alone -- there is deliberately no `internalId` column: reserving one
// is the reviewed, human step ADR-116 requires, never something a scheduled
// pull mints. Nothing public reads this table, and nothing here is visible
// on any consumer surface; the PUB-G1 guard is not wired yet, so a row that
// reached `titles` today would be public at once -- which is exactly why
// intake is a separate table and `catalog_admit` refuses until G1 is live.
export type CatalogIntakeStatus = 'discovered' | 'verified' | 'blocked' | 'duplicate' | 'admitted';

/** Where one field's value came from -- the future `source_records` row, kept inline until admission creates the real rows. */
export interface IntakeProvenance {
  source: string;
  license: string | null;
  licenseStatus: 'commercial_allowed' | 'non_commercial_only' | 'pending_review' | 'unknown';
  url: string | null;
  retrievedAt: string;
}

@Entity('catalog_intake')
// Partial unique indexes on each provider id and the format checks are owned
// by the migration (same split as `titles`' CatalogIdentityGuards).
@Index('UQ_catalog_intake_wikidataId', { synchronize: false })
@Index('UQ_catalog_intake_imdbId', { synchronize: false })
@Index('UQ_catalog_intake_tmdbId', { synchronize: false })
@Index('IDX_catalog_intake_status', ['status'])
export class CatalogIntake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  wikidataId: string | null;

  @Column({ type: 'varchar', nullable: true })
  imdbId: string | null;

  @Column({ type: 'varchar', nullable: true })
  tmdbId: string | null;

  // The adapter key that discovered this candidate (`wikidata`, ...), never
  // free text: `CatalogSourceRegistry` is the allowlist.
  @Column({ type: 'varchar', length: 40 })
  source: string;

  @Column({ type: 'varchar', length: 16, default: 'discovered' })
  status: CatalogIntakeStatus;

  @Column({ type: 'varchar', nullable: true })
  titleEn: string | null;

  @Column({ type: 'varchar', nullable: true })
  titleAr: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  descriptionAr: string | null;

  @Column({ type: 'integer', nullable: true })
  releaseYear: number | null;

  @Column('text', { array: true, default: () => "'{}'" })
  genres: string[];

  @Column({ type: 'varchar', nullable: true })
  originalLanguage: string | null;

  @Column('text', { array: true, default: () => "'{}'" })
  countries: string[];

  /** TMDB's own path (`/abc.jpg`), never a composed URL (ADR-82); NULL until a TMDB adapter fills it. */
  @Column({ type: 'varchar', nullable: true })
  posterPath: string | null;

  /** Per-field provenance, keyed by field name. Becomes `source_records` rows at admission. */
  @Column({ type: 'json', default: () => "'{}'" })
  provenance: Record<string, IntakeProvenance>;

  /** The discovery criteria snapshot (slice, country, reason) so a reviewer sees why this candidate exists. */
  @Column({ type: 'json', nullable: true })
  criteria: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  evaluatorVersion: string | null;

  /** `intake-v1` blocker codes; empty only when the evaluator found the candidate admissible. */
  @Column('text', { array: true, default: () => "'{}'" })
  blockerCodes: string[];

  @Column({ type: 'timestamp', nullable: true })
  evaluatedAt: Date | null;

  /** `titles.internalId` (or another intake row's id) this candidate duplicates -- set by the evaluator, resolved by a human. */
  @Column({ type: 'varchar', nullable: true })
  duplicateOf: string | null;

  @ManyToOne(() => Title, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'admittedTitleId' })
  admittedTitle: Title | null;

  @Column({ type: 'uuid', nullable: true })
  admittedTitleId: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lastAttemptAt: Date | null;

  // Sanitized and truncated like `admin_jobs.lastError`; never a raw exception.
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
