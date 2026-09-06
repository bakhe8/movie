import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import type { FilmFingerprintV1 } from './title-fingerprint.type';

@Entity('titles')
// Expression indexes and the immutable-binding trigger are owned by CatalogIdentityGuards.
@Index('UQ_titles_wikidata_identity', { synchronize: false })
@Index('UQ_titles_imdb_identity', { synchronize: false })
@Index('UQ_titles_tmdb_identity', { synchronize: false })
export class Title {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  internalId: string;

  @Column({ type: 'varchar' })
  titleEn: string;

  @Column({ type: 'varchar' })
  titleAr: string;

  @Column({ type: 'varchar', nullable: true })
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

  // TMDB's path for the film's poster (`/abc.jpg`), never a full URL: the
  // served URL is composed per request with the size wanted and only when
  // the image's `source_records` row allows display in this environment
  // (ADR-82). NULL when TMDB has no poster for the title, or it has no tmdb id.
  @Column({ type: 'varchar', nullable: true })
  posterPath: string | null;

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
