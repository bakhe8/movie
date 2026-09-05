import { MigrationInterface, QueryRunner } from 'typeorm';
import { CANARY_EMAIL_PATTERN_SOURCE } from '../modules/auth/canary-account';

// ADR-107: the post-deploy canary walks the real journey against production,
// so its rows are indistinguishable from a person's until something says
// otherwise. This is that something. Additive and defaulted, so an older
// image keeps booting against a migrated database (CLAUDE.md §3's boot
// contract): no environment variable and no required value change with it.
//
// The backfill covers a canary account created by hand before this column
// existed; from here on AuthService.register stamps it. Same pattern source
// as the runtime check, so the two answers cannot disagree.
export class AddUserIsCanary1788484000000 implements MigrationInterface {
  name = 'AddUserIsCanary1788484000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "isCanary" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`UPDATE "users" SET "isCanary" = true WHERE email ~ $1`, [CANARY_EMAIL_PATTERN_SOURCE]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "isCanary"`);
  }
}
