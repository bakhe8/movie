import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { SourceRecord } from './source-record.entity';
import { Title } from './title.entity';

// POSTERS-MULTI P1 (ADR-120): one row per poster image a title has, so a
// work can show more than the single image `titles.posterPath` carries.
// `titles.posterPath` is deliberately untouched and stays the only poster
// every current read path uses -- this table is purely additive until P3
// wires a batched read and P4 the client.
//
// Same discipline as `titles.posterPath` (ADR-82): TMDB's own relative path
// (`/abc123.jpg`), never a composed URL and never the image bytes. The
// served URL is built per request with the size the caller needs, so a
// stale full URL can never outlive its permission; `CHK_title_posters_path`
// (owned by the migration) refuses anything that is not such a path.
//
// No separate index on `titleId`: the unique constraint below leads with it,
// so P3's `WHERE "titleId" = ANY($1)` read is already covered.
@Entity('title_posters')
@Unique('UQ_title_posters_titleId_posterPath', ['titleId', 'posterPath'])
export class TitlePoster {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Column({ type: 'uuid' })
  titleId: string;

  /** TMDB's own path for this image (`/abc123.jpg`), never a full URL. */
  @Column({ type: 'varchar' })
  posterPath: string;

  // Display order within one title, ascending. P2 assigns it at ingestion;
  // `(sortOrder, posterPath)` is the total order a reader sorts by, so equal
  // values still render in the same sequence on every request. 0 is the
  // image `titles.posterPath` already carries, so the poster a user has
  // seen until now stays first when the carousel appears.
  @Column({ type: 'integer', default: 0 })
  sortOrder: number;

  // The rights-registry row for this image (`fieldName: 'posterPath'`,
  // `non_commercial_only` for TMDB). Nullable and `ON DELETE NO ACTION`
  // like `localized_titles.sourceRecordId`: a registry row is never deleted
  // or overwritten -- a correction appends a new row and points the old
  // one's `supersededBy` at it -- so nothing here may quietly lose the
  // provenance of an image that is still displayed.
  @ManyToOne(() => SourceRecord, { nullable: true })
  @JoinColumn({ name: 'sourceRecordId' })
  sourceRecord: SourceRecord | null;

  @Column({ type: 'uuid', nullable: true })
  sourceRecordId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
