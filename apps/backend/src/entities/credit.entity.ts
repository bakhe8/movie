import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Person } from './person.entity';
import { SourceRecord } from './source-record.entity';
import { Title } from './title.entity';

@Entity('credits')
export class Credit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Index('IDX_credits_titleId')
  @Column({ type: 'uuid' })
  titleId: string;

  @ManyToOne(() => Person)
  @JoinColumn({ name: 'personId' })
  person: Person;

  @Index('IDX_credits_personId')
  @Column({ type: 'uuid' })
  personId: string;

  @Column({ type: 'varchar' })
  role: string;

  @Column({ type: 'integer', nullable: true })
  creditOrder: number | null;

  @ManyToOne(() => SourceRecord, { nullable: true })
  @JoinColumn({ name: 'sourceRecordId' })
  sourceRecord: SourceRecord | null;

  @Column({ type: 'uuid', nullable: true })
  sourceRecordId: string | null;
}
