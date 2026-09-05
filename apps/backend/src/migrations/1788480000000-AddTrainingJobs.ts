import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-100 (remediation brief P0-02): a durable outer layer around the model
// service's own in-memory job ledger, mirroring the mail outbox (ADR-97,
// AddMailOutbox). At most one non-terminal ('queued' or 'running') row per
// profile -- the partial unique index is the idempotency guarantee a
// concurrent double-request relies on. Names follow ADR-91's convention.
export class AddTrainingJobs1788480000000 implements MigrationInterface {
  name = 'AddTrainingJobs1788480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "training_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "modelServiceJobId" character varying,
        "nextAttemptAt" TIMESTAMP NOT NULL,
        "errorKind" character varying,
        "lastError" character varying(500),
        "result" json,
        "startedAt" TIMESTAMP,
        "finishedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_training_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "training_jobs" ADD CONSTRAINT "FK_training_jobs_profileId" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_training_jobs_profileId" ON "training_jobs" ("profileId")`);
    await queryRunner.query(`CREATE INDEX "IDX_training_jobs_status_nextAttemptAt" ON "training_jobs" ("status", "nextAttemptAt")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_training_jobs_one_active_per_profile" ON "training_jobs" ("profileId") WHERE status IN ('queued', 'running')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_training_jobs_one_active_per_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_training_jobs_status_nextAttemptAt"`);
    await queryRunner.query(`DROP INDEX "IDX_training_jobs_profileId"`);
    await queryRunner.query(`ALTER TABLE "training_jobs" DROP CONSTRAINT "FK_training_jobs_profileId"`);
    await queryRunner.query(`DROP TABLE "training_jobs"`);
  }
}
