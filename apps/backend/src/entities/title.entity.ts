import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { FilmFingerprintV1 } from './title-fingerprint.type';

@Entity('titles')
export class Title {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  internalId: string;

  @Column()
  titleEn: string;

  @Column()
  titleAr: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'integer', nullable: true })
  releaseYear: number;

  @Column('simple-array', { nullable: true })
  genres: string[];

  @Column({ type: 'json', nullable: true })
  externalIds: {
    imdb?: string;
    tmdb?: string;
    wikidata?: string;
  };

  @Column({ type: 'json', nullable: true })
  fingerprint: FilmFingerprintV1 | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
