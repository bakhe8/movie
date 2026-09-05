import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Title } from './title.entity';

@Entity('embeddings')
export class Embedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Index('IDX_embeddings_titleId')
  @Column({ type: 'uuid' })
  titleId: string;

  @Column('real', { array: true })
  vector: number[];

  @Column({ type: 'varchar' })
  modelVersion: string;

  @Column({ type: 'varchar' })
  embeddingType: 'fingerprint' | 'hybrid';

  @Column({ type: 'json', nullable: true })
  metadata: {
    generatedBy?: string;
    confidence?: number;
  };

  @CreateDateColumn()
  createdAt: Date;
}
