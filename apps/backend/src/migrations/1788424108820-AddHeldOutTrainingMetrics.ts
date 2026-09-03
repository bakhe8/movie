import { MigrationInterface, QueryRunner } from "typeorm";

// Gap 2 (IMPLEMENTATION_STATUS.md, ADR-31): training.py now holds out the
// most recent ~20% of a profile's completed triads (when there are at least
// 5) and evaluates NLL and pairwise accuracy on that slice instead of only
// reporting in-sample numbers (RANKING_ALGORITHM.md §6). These three columns
// are where those results are persisted; see UserModelSnapshot for the
// per-column semantics, in particular that all three stay NULL below the
// 5-triad floor.
export class AddHeldOutTrainingMetrics1788424108820 implements MigrationInterface {
    name = 'AddHeldOutTrainingMetrics1788424108820'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "heldOutTriadCount" integer`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "heldOutNll" real`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "heldOutPairwiseAccuracy" real`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "heldOutPairwiseAccuracy"`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "heldOutNll"`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "heldOutTriadCount"`);
    }

}
