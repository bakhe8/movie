import { MigrationInterface, QueryRunner } from "typeorm";

// ADMIN-W7 attribution gap (owner decision 2026-09-06, options panel):
// `experimentId` already existed on both tables but was always written null --
// TriadsService/RecommendationsService call ExperimentsService.armFor() and
// steer behaviour with the result, yet never recorded which arm a row was
// created under. This adds the missing `arm` column beside the existing
// `experimentId`; no backfill (owner decision) -- historical rows stay null
// rather than a guessed attribution.
export class AddExperimentArm1788508000000 implements MigrationInterface {
    name = 'AddExperimentArm1788508000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "triads" ADD "arm" character varying`);
        await queryRunner.query(`ALTER TABLE "recommendations" ADD "arm" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recommendations" DROP COLUMN "arm"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "arm"`);
    }

}
