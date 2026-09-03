import { MigrationInterface, QueryRunner } from "typeorm";

// The product is Arabic-first (blueprint §2, §5.1); a profile created without an
// explicit language must default to 'ar', matching Profile.preferredLanguage.
// Existing rows are untouched -- they hold whatever the user chose.
export class ArabicFirstProfileDefault1788418200000 implements MigrationInterface {
    name = 'ArabicFirstProfileDefault1788418200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "profiles" ALTER COLUMN "preferredLanguage" SET DEFAULT 'ar'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "profiles" ALTER COLUMN "preferredLanguage" SET DEFAULT 'en'`);
    }

}
