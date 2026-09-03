import { MigrationInterface, QueryRunner } from "typeorm";

// M4 of the migration plan (SCHEMA.md §2.4): model reproducibility and
// experimentation -- model_versions, experiments, experiment_assignments --
// plus four columns on user_model_snapshots (posterior, recentWeights,
// exceptions, calibratedAgainst). Schema only; nothing writes any of this
// yet (random-v1 has no experiments, training.py doesn't stamp a model
// version row, PlackettLuceRanker.fit() never populates posterior/exceptions).
//
// user_model_snapshots.calibratedAgainst is added here as a plain nullable
// varchar, WITHOUT its target's FK constraint: SCHEMA.md §2.2 names it as a
// foreign key to shared_latent_space_versions(version), but that table is
// M7's, not M4's -- the plan's own step split has M4 referencing a table
// that doesn't exist until three steps later. Adding an unconstrained
// column now and the FK constraint itself in M7 (once the target table
// exists) is the only order that keeps every intermediate migration state
// valid; noted for whoever runs M7 next.
export class AddM4ModelVersioningAndExperiments1788442000000 implements MigrationInterface {
    name = 'AddM4ModelVersioningAndExperiments1788442000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "posterior" json`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "recentWeights" real array`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "exceptions" json`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "calibratedAgainst" character varying`);
        await queryRunner.query(`CREATE INDEX "IDX_user_model_snapshots_profileId_createdAt" ON "user_model_snapshots" ("profileId", "createdAt" DESC)`);

        await queryRunner.query(`
            CREATE TABLE "model_versions" (
                "version" character varying NOT NULL,
                "rankerType" character varying NOT NULL,
                "fingerprintSchemaVersion" character varying NOT NULL,
                "codeRef" character varying,
                "dataCutoff" TIMESTAMP,
                "features" json,
                "thresholds" json,
                "evalReport" json,
                "active" boolean NOT NULL DEFAULT false,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_model_versions" PRIMARY KEY ("version")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "experiments" (
                "id" character varying NOT NULL,
                "hypothesis" text NOT NULL,
                "status" character varying NOT NULL,
                "startedAt" TIMESTAMP,
                "endedAt" TIMESTAMP,
                "config" json,
                CONSTRAINT "PK_experiments" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "experiment_assignments" (
                "experimentId" character varying NOT NULL,
                "profileId" uuid NOT NULL,
                "arm" character varying NOT NULL,
                "assignedAt" TIMESTAMP,
                CONSTRAINT "PK_experiment_assignments" PRIMARY KEY ("experimentId", "profileId")
            )
        `);
        await queryRunner.query(`ALTER TABLE "experiment_assignments" ADD CONSTRAINT "FK_experiment_assignments_experimentId" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "experiment_assignments" ADD CONSTRAINT "FK_experiment_assignments_profileId" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "experiment_assignments" DROP CONSTRAINT "FK_experiment_assignments_profileId"`);
        await queryRunner.query(`ALTER TABLE "experiment_assignments" DROP CONSTRAINT "FK_experiment_assignments_experimentId"`);
        await queryRunner.query(`DROP TABLE "experiment_assignments"`);

        await queryRunner.query(`DROP TABLE "experiments"`);
        await queryRunner.query(`DROP TABLE "model_versions"`);

        await queryRunner.query(`DROP INDEX "IDX_user_model_snapshots_profileId_createdAt"`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "calibratedAgainst"`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "exceptions"`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "recentWeights"`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "posterior"`);
    }

}
