import { MigrationInterface, QueryRunner } from 'typeorm';

// Account settings: change email (owner-approved design 2026-09-06). Same
// shape as password_resets (ADR-85): a single-use, hashed, expiring token
// per pending change; the account's live row (userId, usedAt IS NULL,
// revokedAt IS NULL) is what EmailChangeService.request() revokes before
// issuing a new one. Purely additive -- no existing table changes.
export class AddEmailChanges1788498000000 implements MigrationInterface {
  name = 'AddEmailChanges1788498000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "email_changes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "newEmail" character varying NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "usedAt" TIMESTAMP,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_changes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "email_changes" ADD CONSTRAINT "FK_email_changes_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_email_changes_tokenHash" ON "email_changes" ("tokenHash")`);
    await queryRunner.query(`CREATE INDEX "IDX_email_changes_userId" ON "email_changes" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_email_changes_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_email_changes_tokenHash"`);
    await queryRunner.query(`ALTER TABLE "email_changes" DROP CONSTRAINT "FK_email_changes_userId"`);
    await queryRunner.query(`DROP TABLE "email_changes"`);
  }
}
