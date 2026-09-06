import { MigrationInterface, QueryRunner } from 'typeorm';

// CAT-J1 (ADR-121): `catalog_intake` holds candidates a source adapter
// discovered, outside `titles`, until a human admits them. Additive only --
// no existing table or column changes. The three partial unique indexes and
// the format checks mirror `titles`' CatalogIdentityGuards so a candidate
// can never carry a malformed or duplicated provider id even before it is
// compared against `titles`. `admittedTitleId` is the only link to `titles`
// and is `ON DELETE SET NULL`: deleting a title must not delete the record
// of how it was found. At least one provider id is required -- a candidate
// with no identity at all has nothing to be deduplicated by.
export class AddCatalogIntake1788502000000 implements MigrationInterface {
  name = 'AddCatalogIntake1788502000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog_intake" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "wikidataId" character varying,
        "imdbId" character varying,
        "tmdbId" character varying,
        "source" character varying(40) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'discovered',
        "titleEn" character varying,
        "titleAr" character varying,
        "description" text,
        "descriptionAr" text,
        "releaseYear" integer,
        "genres" text[] NOT NULL DEFAULT '{}',
        "originalLanguage" character varying,
        "countries" text[] NOT NULL DEFAULT '{}',
        "posterPath" character varying,
        "provenance" json NOT NULL DEFAULT '{}',
        "criteria" json,
        "evaluatorVersion" character varying,
        "blockerCodes" text[] NOT NULL DEFAULT '{}',
        "evaluatedAt" TIMESTAMP,
        "duplicateOf" character varying,
        "admittedTitleId" uuid,
        "attempts" integer NOT NULL DEFAULT 0,
        "lastAttemptAt" TIMESTAMP,
        "lastError" character varying(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_intake" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_catalog_intake_has_identity" CHECK ("wikidataId" IS NOT NULL OR "imdbId" IS NOT NULL OR "tmdbId" IS NOT NULL),
        CONSTRAINT "CHK_catalog_intake_wikidata_format" CHECK ("wikidataId" IS NULL OR "wikidataId" ~ '^Q[1-9][0-9]*$'),
        CONSTRAINT "CHK_catalog_intake_imdb_format" CHECK ("imdbId" IS NULL OR "imdbId" ~ '^tt[0-9]{7,}$'),
        CONSTRAINT "CHK_catalog_intake_tmdb_format" CHECK ("tmdbId" IS NULL OR "tmdbId" ~ '^[1-9][0-9]*$'),
        CONSTRAINT "CHK_catalog_intake_status" CHECK ("status" IN ('discovered', 'verified', 'blocked', 'duplicate', 'admitted')),
        CONSTRAINT "CHK_catalog_intake_posterPath" CHECK ("posterPath" IS NULL OR "posterPath" ~ '^/[A-Za-z0-9_-]+[.][A-Za-z0-9]+$')
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "catalog_intake" ADD CONSTRAINT "FK_catalog_intake_admittedTitleId" FOREIGN KEY ("admittedTitleId") REFERENCES "titles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_catalog_intake_wikidataId" ON "catalog_intake" ("wikidataId") WHERE "wikidataId" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_catalog_intake_imdbId" ON "catalog_intake" ("imdbId") WHERE "imdbId" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_catalog_intake_tmdbId" ON "catalog_intake" ("tmdbId") WHERE "tmdbId" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_intake_status" ON "catalog_intake" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_catalog_intake_status"`);
    await queryRunner.query(`DROP INDEX "UQ_catalog_intake_tmdbId"`);
    await queryRunner.query(`DROP INDEX "UQ_catalog_intake_imdbId"`);
    await queryRunner.query(`DROP INDEX "UQ_catalog_intake_wikidataId"`);
    await queryRunner.query(`ALTER TABLE "catalog_intake" DROP CONSTRAINT "FK_catalog_intake_admittedTitleId"`);
    await queryRunner.query(`DROP TABLE "catalog_intake"`);
  }
}
