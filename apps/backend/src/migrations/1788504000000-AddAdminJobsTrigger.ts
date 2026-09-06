import { MigrationInterface, QueryRunner } from 'typeorm';

// ADMIN-W5 follow-up (owner-approved, relayed by the coordinator for the
// catalog-pull-scheduling study): a job created by a future scheduler has no
// signed-in admin to blame `requestedBy` on, so that column becomes
// nullable, and `trigger` records which path created the row.
export class AddAdminJobsTrigger1788504000000 implements MigrationInterface {
  name = 'AddAdminJobsTrigger1788504000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admin_jobs" ALTER COLUMN "requestedBy" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "admin_jobs" ADD "trigger" character varying(16) NOT NULL DEFAULT 'admin'`);
    // One non-terminal job per type at a time (item 5): the same proven
    // shape as training_jobs' one-active-per-profile partial unique index --
    // AdminJobsService.create() pre-checks for a friendly 409, this is the
    // race-proof backstop against two concurrent creates of the same type.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admin_jobs_one_active_per_type" ON "admin_jobs" ("type") WHERE status IN ('queued', 'running')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_admin_jobs_one_active_per_type"`);
    await queryRunner.query(`ALTER TABLE "admin_jobs" DROP COLUMN "trigger"`);
    await queryRunner.query(`UPDATE "admin_jobs" SET "requestedBy" = uuid_generate_v4() WHERE "requestedBy" IS NULL`);
    await queryRunner.query(`ALTER TABLE "admin_jobs" ALTER COLUMN "requestedBy" SET NOT NULL`);
  }
}
