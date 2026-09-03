import { MigrationInterface, QueryRunner } from "typeorm";

// Onboarding (blueprint §4.1, SPECIFICATION §5.1 step 2): the profile's
// market (ISO 3166-1 alpha-2) and the platforms the user says they can
// watch on. Display and Watchability only -- never a taste prior (§4.1,
// §10.2: choosing Arabic does not mean preferring Arabic films, living in
// Saudi Arabia does not down-rank foreign ones). First slice of the M1
// plan in SCHEMA.md §2.4.
export class AddProfileMarketAndPlatforms1788432000000 implements MigrationInterface {
    name = 'AddProfileMarketAndPlatforms1788432000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // NULL = not chosen yet; the onboarding screen shows until it is set.
        await queryRunner.query(`ALTER TABLE "profiles" ADD "market" character varying(2)`);
        await queryRunner.query(`ALTER TABLE "profiles" ADD "platforms" text array NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "platforms"`);
        await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "market"`);
    }

}
