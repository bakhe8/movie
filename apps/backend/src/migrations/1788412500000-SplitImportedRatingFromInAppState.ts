import { MigrationInterface, QueryRunner } from "typeorm";

// Renames user_title_state.rating -> importedRating and adds ratingSource, so the schema
// itself makes clear this is an import-only, low-confidence auxiliary signal — never a
// value the general PATCH .../titles/:titleId/state endpoint writes. See
// UpdateTitleStateDto and UserTitleStateService.upsert (blueprint §2.4 principle #2, §4.5).
export class SplitImportedRatingFromInAppState1788412500000 implements MigrationInterface {
    name = 'SplitImportedRatingFromInAppState1788412500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_title_state" RENAME COLUMN "rating" TO "importedRating"`);
        await queryRunner.query(`ALTER TABLE "user_title_state" ADD "ratingSource" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_title_state" DROP COLUMN "ratingSource"`);
        await queryRunner.query(`ALTER TABLE "user_title_state" RENAME COLUMN "importedRating" TO "rating"`);
    }

}
