import { MigrationInterface, QueryRunner } from 'typeorm';

// ADMIN-W6 (plan §17.3 "إعدادات مكتوبة النوع ومؤرخة"): a typed, versioned
// settings registry. `admin_settings` holds the current value per key (a
// row exists only once someone has actually published an override --
// AdminSettingsService.get() resolves a missing key to the definition's
// env var or hardcoded default); `admin_setting_versions` is the append-
// only history a rollback reads from and is never edited or deleted.
export class AddAdminSettings1788506000000 implements MigrationInterface {
  name = 'AddAdminSettings1788506000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_settings" (
        "key" character varying(100) NOT NULL,
        "value" json NOT NULL,
        "version" integer NOT NULL,
        "modifiedBy" uuid,
        "reason" character varying(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_settings" PRIMARY KEY ("key")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "admin_setting_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(100) NOT NULL,
        "value" json NOT NULL,
        "version" integer NOT NULL,
        "modifiedBy" uuid,
        "reason" character varying(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_setting_versions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_admin_setting_versions_key" ON "admin_setting_versions" ("key")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admin_setting_versions_key_version" ON "admin_setting_versions" ("key", "version")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_admin_setting_versions_key_version"`);
    await queryRunner.query(`DROP INDEX "IDX_admin_setting_versions_key"`);
    await queryRunner.query(`DROP TABLE "admin_setting_versions"`);
    await queryRunner.query(`DROP TABLE "admin_settings"`);
  }
}
