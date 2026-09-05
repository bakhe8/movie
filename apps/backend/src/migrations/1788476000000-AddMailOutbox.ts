import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-97: the mail outbox. A row per outgoing message, the sealed body wiped
// once the row is delivered or dead; cascades with the account like
// password_resets. Names follow ADR-91's convention.
export class AddMailOutbox1788476000000 implements MigrationInterface {
  name = 'AddMailOutbox1788476000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mail_outbox" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid,
        "kind" character varying(64) NOT NULL,
        "toAddress" character varying NOT NULL,
        "subject" character varying NOT NULL,
        "bodySealed" bytea,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "nextAttemptAt" TIMESTAMP NOT NULL,
        "expiresAt" TIMESTAMP,
        "lastError" character varying(500),
        "providerMessageId" character varying,
        "deliveredAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mail_outbox" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "mail_outbox" ADD CONSTRAINT "FK_mail_outbox_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_mail_outbox_userId" ON "mail_outbox" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_mail_outbox_status_nextAttemptAt" ON "mail_outbox" ("status", "nextAttemptAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_mail_outbox_status_nextAttemptAt"`);
    await queryRunner.query(`DROP INDEX "IDX_mail_outbox_userId"`);
    await queryRunner.query(`ALTER TABLE "mail_outbox" DROP CONSTRAINT "FK_mail_outbox_userId"`);
    await queryRunner.query(`DROP TABLE "mail_outbox"`);
  }
}
