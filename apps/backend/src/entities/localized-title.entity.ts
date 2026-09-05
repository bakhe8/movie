import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SourceRecord } from './source-record.entity';
import { Title } from './title.entity';

export type LocalizedTitleKind = 'original' | 'official' | 'alternate' | 'transliteration';

@Entity('localized_titles')
export class LocalizedTitle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  parentTitle: Title;

  @Index('IDX_localized_titles_titleId')
  @Column({ type: 'uuid' })
  titleId: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar', length: 5 })
  language: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  region: string | null;

  @Column({ type: 'varchar' })
  kind: LocalizedTitleKind;

  @Column({ type: 'integer', default: 0 })
  displayPriority: number;

  @ManyToOne(() => SourceRecord, { nullable: true })
  @JoinColumn({ name: 'sourceRecordId' })
  sourceRecord: SourceRecord | null;

  @Column({ type: 'uuid', nullable: true })
  sourceRecordId: string | null;
}
