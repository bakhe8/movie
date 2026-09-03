import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Title } from './title.entity';

@Entity('embeddings')
export class Embedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Column()
  titleId: string;

  @Column('real', { array: true })
  vector: number[];

  @Column()
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
