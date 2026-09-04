import { MigrationInterface, QueryRunner } from 'typeorm';

// ALPHA_PLAN 7.5: first-party product analytics. `profileId` is SET NULL for
// the same reason consents and privacy_requests are (ADR-80) -- deleting a
// profile must not silently rewrite the funnel counts, and the surviving row
// keeps nothing that points back at a person.
export class AddAnalyticsEvents1788466000000 implements MigrationInterface {
  name = 'AddAnalyticsEvents1788466000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "analytics_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "profileId" uuid,
        "name" character varying(64) NOT NULL,
        "occurredAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "PK_analytics_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "analytics_events" ADD CONSTRAINT "FK_analytics_events_profileId" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_analytics_events_name_occurredAt" ON "analytics_events" ("name", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_analytics_events_profileId_occurredAt" ON "analytics_events" ("profileId", "occurredAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_analytics_events_profileId_occurredAt"`);
    await queryRunner.query(`DROP INDEX "IDX_analytics_events_name_occurredAt"`);
    await queryRunner.query(`ALTER TABLE "analytics_events" DROP CONSTRAINT "FK_analytics_events_profileId"`);
    await queryRunner.query(`DROP TABLE "analytics_events"`);
  }
}
