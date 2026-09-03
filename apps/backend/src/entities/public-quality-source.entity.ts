import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SourceRecord } from './source-record.entity';
import { Title } from './title.entity';

// BP §10.3: per-source, never averaged into one number -- one row per
// (title, source), the application decides how to present them together.
@Entity('public_quality_sources')
export class PublicQualitySource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Index('IDX_public_quality_sources_titleId')
  @Column({ type: 'uuid' })
  titleId: string;

  @Column()
  source: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  market: string | null;

  @Column({ type: 'real', nullable: true })
  value: number | null;

  @Column({ type: 'varchar', nullable: true })
  scale: string | null;

  @Column({ type: 'integer', nullable: true })
  votes: number | null;

  @Column({ type: 'real', nullable: true })
  polarization: number | null;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  @ManyToOne(() => SourceRecord)
  @JoinColumn({ name: 'sourceRecordId' })
  sourceRecord: SourceRecord;

  @Column({ type: 'uuid' })
  sourceRecordId: string;
}
