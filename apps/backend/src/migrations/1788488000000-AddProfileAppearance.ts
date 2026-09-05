import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive: existing profiles keep their current browser preference. */
export class AddProfileAppearance1788488000000 implements MigrationInterface {
  name = 'AddProfileAppearance1788488000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" ADD "preferredAppearance" character varying(16)`);
    await queryRunner.query(`ALTER TABLE "profiles" ADD CONSTRAINT "CHK_profiles_preferredAppearance" CHECK ("preferredAppearance" IN ('cinema', 'premiere', 'montage'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP CONSTRAINT "CHK_profiles_preferredAppearance"`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "preferredAppearance"`);
  }
}
