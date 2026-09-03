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

  // Wikidata P364, single value (blueprint gap 6/gap 5, BP §9.2's language
  // diversity axis). NULL for titles ingested before this column existed or
  // whose source has no recorded original language.
  @Column({ type: 'varchar', nullable: true })
  originalLanguage: string | null;

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
