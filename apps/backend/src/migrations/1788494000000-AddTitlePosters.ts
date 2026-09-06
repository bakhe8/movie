import { MigrationInterface, QueryRunner } from 'typeorm';

// POSTERS-MULTI P1 (ADR-120): `title_posters`, one row per poster image a
// title has. Schema only -- nothing writes to it yet; P2's backfill fills it
// from TMDB's `/movie/{id}/images` (97.2% of the catalog has 2+ posters, P0),
// P3 reads it batched and P4 reaches the client. `titles.posterPath` is not
// touched, dropped or migrated into this table: it stays the single poster
// every current read path (`PosterService`) uses, so this migration cannot
// break a consumer, and the same path also appears here at `sortOrder = 0`.
//
// The path is TMDB's own (`/abc123.jpg`), never a composed URL -- ADR-82's
// rule, now enforced rather than merely documented: `CHK_title_posters_path`
// rejects anything with a scheme, a host or a second path segment, so a full
// URL cannot be stored and outlive the permission it was fetched under.
//
// `UQ_title_posters_titleId_posterPath` makes P2's backfill idempotent (the
// same image can never be inserted twice for a title) and leads with
// `titleId`, so P3's batched read needs no second index.
export class AddTitlePosters1788494000000 implements MigrationInterface {
  name = 'AddTitlePosters1788494000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "title_posters" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "posterPath" character varying NOT NULL,
                "sortOrder" integer NOT NULL DEFAULT 0,
                "sourceRecordId" uuid,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_title_posters" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_title_posters_titleId_posterPath" UNIQUE ("titleId", "posterPath"),
                CONSTRAINT "CHK_title_posters_path" CHECK ("posterPath" ~ '^/[A-Za-z0-9_-]+[.][A-Za-z0-9]+$'),
                CONSTRAINT "CHK_title_posters_sortOrder" CHECK ("sortOrder" >= 0)
            )
        `);
    await queryRunner.query(
      `ALTER TABLE "title_posters" ADD CONSTRAINT "FK_title_posters_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "title_posters" ADD CONSTRAINT "FK_title_posters_sourceRecordId" FOREIGN KEY ("sourceRecordId") REFERENCES "source_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "title_posters"`);
  }
}
