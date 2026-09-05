import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-99 (remediation brief P0-04): a triad row names the *set* it asks
// about and the purpose it serves. `setHash` is md5 of the three title ids
// sorted and joined by ',' -- identical to modules/triads/triad-set.ts, so
// rows written by the code and rows backfilled here agree. `purpose` is
// 'learn' for the first time a profile answers a set and 'verify' for every
// later repeat of it; `countsTowardActivation` follows purpose. The backfill
// ranks each profile's completed rows per set by answer time, so history
// keeps exactly the meaning the live code gives new rows. Names follow
// ADR-91's convention.
export class AddTriadSetHashAndPurpose1788478000000 implements MigrationInterface {
  name = 'AddTriadSetHashAndPurpose1788478000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "triads" ADD "setHash" character varying(32)`);
    await queryRunner.query(`ALTER TABLE "triads" ADD "purpose" character varying NOT NULL DEFAULT 'learn'`);
    await queryRunner.query(`ALTER TABLE "triads" ADD "countsTowardActivation" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`
      UPDATE "triads"
      SET "setHash" = md5(array_to_string(ARRAY(SELECT unnest("titleIds")::text ORDER BY 1), ','))
      WHERE "titleIds" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "triads" t
      SET "purpose" = 'verify', "countsTowardActivation" = false
      FROM (
        SELECT id,
               row_number() OVER (
                 PARTITION BY "profileId", "setHash"
                 ORDER BY COALESCE("answeredAt", "createdAt"), "createdAt", id
               ) AS rn
        FROM "triads"
        WHERE status = 'completed' AND "setHash" IS NOT NULL
      ) s
      WHERE t.id = s.id AND s.rn > 1
    `);
    await queryRunner.query(`CREATE INDEX "IDX_triads_profileId_setHash" ON "triads" ("profileId", "setHash")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_triads_profileId_setHash"`);
    await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "countsTowardActivation"`);
    await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "purpose"`);
    await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "setHash"`);
  }
}
