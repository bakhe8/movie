import { MigrationInterface, QueryRunner } from 'typeorm';

// Addresses are stored trimmed and lower-cased from now on (auth/email.ts);
// this folds the rows registered before that. A row is left alone when the
// folded address already belongs to another account -- two accounts that
// differ only by case are an owner's call, not a migration's -- so the
// unique index cannot fail the release. Nothing to undo: the original casing
// is not kept, and login/reset now fold their input anyway.
export class NormalizeUserEmails1788474000000 implements MigrationInterface {
  name = 'NormalizeUserEmails1788474000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users" u
      SET "email" = lower(btrim(u."email"))
      WHERE u."email" <> lower(btrim(u."email"))
        AND NOT EXISTS (
          SELECT 1 FROM "users" v
          WHERE v."email" = lower(btrim(u."email")) AND v."id" <> u."id"
        )
    `);
  }

  public async down(): Promise<void> {
    // Irreversible by nature (see above); the rows stay folded.
  }
}
