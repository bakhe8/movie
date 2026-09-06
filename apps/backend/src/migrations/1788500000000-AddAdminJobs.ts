import { MigrationInterface, QueryRunner } from 'typeorm';

// ADMIN-W5 (plan §17.2 "مركز مهام دائم"): the durable job queue behind every
// allowlisted admin task, mirroring `training_jobs` (AddTrainingJobs). No FK
// to `users` on `requestedBy` -- an admin job's audit trail is the
// `audit_log` row `AdminJobsService` writes on create/cancel, same as every
// other admin write; this column is for display only. `idempotencyKey` is a
// partial unique index (present values only) so a repeated request with the
// same key is refused as a duplicate rather than silently ignored -- the
// service reads the conflict and returns the existing row.
export class AddAdminJobs1788500000000 implements MigrationInterface {
  name = 'AddAdminJobs1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" character varying(100) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'queued',
        "params" json,
        "dryRun" boolean NOT NULL DEFAULT false,
        "progress" json,
        "result" json,
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" character varying(500),
        "nextAttemptAt" TIMESTAMP NOT NULL,
        "cancelRequested" boolean NOT NULL DEFAULT false,
        "requestedBy" uuid NOT NULL,
        "idempotencyKey" character varying(200),
        "startedAt" TIMESTAMP,
        "finishedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_admin_jobs_status_nextAttemptAt" ON "admin_jobs" ("status", "nextAttemptAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_admin_jobs_type" ON "admin_jobs" ("type")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admin_jobs_idempotencyKey" ON "admin_jobs" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_admin_jobs_idempotencyKey"`);
    await queryRunner.query(`DROP INDEX "IDX_admin_jobs_type"`);
    await queryRunner.query(`DROP INDEX "IDX_admin_jobs_status_nextAttemptAt"`);
    await queryRunner.query(`DROP TABLE "admin_jobs"`);
  }
}
