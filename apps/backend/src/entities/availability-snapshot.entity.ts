import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SourceRecord } from './source-record.entity';
import { Title } from './title.entity';

// BP §6 (access layer): a dated snapshot from a licensed partner, not a
// live availability check -- checkedAt/validUntil bound how stale it is.
@Entity('availability_snapshots')
export class AvailabilitySnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Index('IDX_availability_snapshots_titleId')
  @Column({ type: 'uuid' })
  titleId: string;

  @Column({ type: 'varchar', length: 2 })
  market: string;

  @Column({ type: 'varchar' })
  provider: string;

  @Column({ type: 'varchar', nullable: true })
  offerType: string | null;

  @Column('text', { array: true, nullable: true })
  audioLanguages: string[] | null;

  @Column('text', { array: true, nullable: true })
  subtitleLanguages: string[] | null;

  @Column({ type: 'timestamp' })
  checkedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  validUntil: Date | null;

  @ManyToOne(() => SourceRecord)
  @JoinColumn({ name: 'sourceRecordId' })
  sourceRecord: SourceRecord;

  @Column({ type: 'uuid' })
  sourceRecordId: string;
}
