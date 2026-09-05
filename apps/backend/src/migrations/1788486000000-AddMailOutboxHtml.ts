import { MigrationInterface, QueryRunner } from 'typeorm';

// The password-reset message carries a Kolme-branded HTML part beside its
// text part (owner decision 2026-09-05, ADR-111), and the outbox has to hold
// it until the row is delivered -- sealed with the same key as the text,
// since it carries the same link.
//
// Additive and nullable, so an older image keeps booting against a migrated
// database and every row already queued is still deliverable as text alone
// (CLAUDE.md §3's boot contract): no environment variable changes with it.
export class AddMailOutboxHtml1788486000000 implements MigrationInterface {
  name = 'AddMailOutboxHtml1788486000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mail_outbox" ADD "htmlSealed" bytea`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mail_outbox" DROP COLUMN "htmlSealed"`);
  }
}
