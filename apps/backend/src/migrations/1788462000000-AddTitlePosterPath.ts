import { MigrationInterface, QueryRunner } from "typeorm";

// Owner decision 2026-09-04 (board B4, IDENTITY_DECISIONS §26): every film
// carries a poster. `scripts/fetch-tmdb-posters` stores TMDB's path per
// title in the catalog fixture and a `source_records` row per image
// (`non_commercial_only`); this is the column the loaded catalog keeps it
// in. The path only -- the served URL is composed at read time with the
// size the caller needs, and is gated on the registry row's licence status
// (ADR-82), so a stale full URL can never outlive its permission.
export class AddTitlePosterPath1788462000000 implements MigrationInterface {
    name = 'AddTitlePosterPath1788462000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "titles" ADD "posterPath" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "posterPath"`);
    }

}
