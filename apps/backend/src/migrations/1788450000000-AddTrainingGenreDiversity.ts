import { MigrationInterface, QueryRunner } from "typeorm";

// Blueprint gap 5 (confidence band, BP §9.2): the count of distinct genres
// across the titles in the triads a snapshot was actually trained on --
// "sufficient effective evidence (not one series repeated)" and "diversity
// of ... genres" read together as a genre-repetition check, the only one of
// §9.2's three named diversity axes (directors/languages/genres) this
// codebase has real data for today (people/credits/source_records are still
// empty, blueprint gap 6). A well-defined single number gets its own typed
// column, matching heldOutTriadCount/heldOutNll/heldOutPairwiseAccuracy's
// pattern rather than being folded into posterior's per-weight-uncertainty
// JSON, which is a different concept.
export class AddTrainingGenreDiversity1788450000000 implements MigrationInterface {
    name = 'AddTrainingGenreDiversity1788450000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "trainingGenreDiversity" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "trainingGenreDiversity"`);
    }

}
