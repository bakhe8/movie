import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Title } from './title.entity';

// Rights registry: one row per (field, source) claim about a title, never
// overwritten in place -- a correction creates a new row and points the old
// one's supersededBy at it (BP §11.3). titleId is nullable: a source record
// need not describe a specific title (e.g. a platform-wide policy claim).
export type SourceRecordLicenseStatus = 'commercial_allowed' | 'non_commercial_only' | 'pending_review' | 'unknown';
export type SourceRecordReviewStatus = 'unreviewed' | 'sampled' | 'human_verified';

@Entity('source_records')
export class SourceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title | null;

  @Index('IDX_source_records_titleId')
  @Column({ type: 'uuid', nullable: true })
  titleId: string | null;

  @Column()
  fieldName: string;

  @Column({ type: 'text', nullable: true })
  value: string | null;

  @Column()
  source: string;

  @Column({ type: 'varchar', nullable: true })
  license: string | null;

  @Column({ type: 'varchar' })
  licenseStatus: SourceRecordLicenseStatus;

  @Column({ type: 'boolean', nullable: true })
  allowsStorage: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  allowsDerivation: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  allowsTraining: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  attributionRequired: boolean | null;

  @Column({ type: 'timestamp', nullable: true })
  retentionUntil: Date | null;

  @Column({ type: 'varchar', nullable: true })
  fallbackPlan: string | null;

  @Column({ type: 'real', nullable: true })
  confidence: number | null;

  @Column({ type: 'varchar', nullable: true })
  extractorVersion: string | null;

  @Column({ type: 'varchar', nullable: true })
  reviewStatus: SourceRecordReviewStatus | null;

  @ManyToOne(() => SourceRecord, { nullable: true })
  @JoinColumn({ name: 'supersededBy' })
  supersededByRecord: SourceRecord | null;

  @Column({ type: 'uuid', nullable: true })
  supersededBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  retrievedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  validFrom: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
