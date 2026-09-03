import { MigrationInterface, QueryRunner } from "typeorm";

// Blueprint gap 5 (confidence band, BP §9.2): the third and last of §9.2's
// three named diversity axes (directors/languages/genres) -- genre (ADR-62)
// and language (ADR-64) already had real data; director was blocked on
// people/credits/source_records staying empty until a real ingestion pass
// ran (blueprint gap 6). That pass landed 2026-09-04 (ADR-70): 313 director
// credits across 295 of 300 demo titles. This migration only adds the
// column that stores the count -- the same well-defined single number as
// trainingGenreDiversity/trainingLanguageDiversity, not folded into
// posterior's per-weight JSON, which is a different concept.
export class AddTrainingDirectorDiversity1788456000000 implements MigrationInterface {
    name = 'AddTrainingDirectorDiversity1788456000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "trainingDirectorDiversity" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "trainingDirectorDiversity"`);
    }

}
