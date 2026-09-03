import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Title } from './title.entity';

export type TitleEditionKind = 'theatrical' | 'directors_cut' | 'dub' | 'subtitled' | 'other';

@Entity('title_editions')
export class TitleEdition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Index('IDX_title_editions_titleId')
  @Column({ type: 'uuid' })
  titleId: string;

  @Column({ type: 'varchar' })
  kind: TitleEditionKind;

  @Column({ type: 'varchar', length: 5, nullable: true })
  audioLanguage: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  subtitleLanguage: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
