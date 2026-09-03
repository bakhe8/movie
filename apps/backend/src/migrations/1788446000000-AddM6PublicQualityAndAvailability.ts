import { MigrationInterface, QueryRunner } from "typeorm";

// M6 of the migration plan (SCHEMA.md §2.4): the Public Quality and
// Watchability layers -- public_quality_sources (BP §10.3, kept per-source
// and never averaged into one number) and availability_snapshots (BP §6,
// dated snapshots from a licensed partner). Schema only, and further behind
// than every other step: both tables need a licensed data source before
// anything can populate them, which this migration does not provide.
export class AddM6PublicQualityAndAvailability1788446000000 implements MigrationInterface {
    name = 'AddM6PublicQualityAndAvailability1788446000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "public_quality_sources" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "source" character varying NOT NULL,
                "market" character varying(2),
                "value" real,
                "scale" character varying,
                "votes" integer,
                "polarization" real,
                "capturedAt" TIMESTAMP NOT NULL,
                "sourceRecordId" uuid NOT NULL,
                CONSTRAINT "PK_public_quality_sources" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "public_quality_sources" ADD CONSTRAINT "FK_public_quality_sources_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "public_quality_sources" ADD CONSTRAINT "FK_public_quality_sources_sourceRecordId" FOREIGN KEY ("sourceRecordId") REFERENCES "source_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_public_quality_sources_titleId" ON "public_quality_sources" ("titleId")`);

        await queryRunner.query(`
            CREATE TABLE "availability_snapshots" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "market" character varying(2) NOT NULL,
                "provider" character varying NOT NULL,
                "offerType" character varying,
                "audioLanguages" text array,
                "subtitleLanguages" text array,
                "checkedAt" TIMESTAMP NOT NULL,
                "validUntil" TIMESTAMP,
                "sourceRecordId" uuid NOT NULL,
                CONSTRAINT "PK_availability_snapshots" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "availability_snapshots" ADD CONSTRAINT "FK_availability_snapshots_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "availability_snapshots" ADD CONSTRAINT "FK_availability_snapshots_sourceRecordId" FOREIGN KEY ("sourceRecordId") REFERENCES "source_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_availability_snapshots_titleId" ON "availability_snapshots" ("titleId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_availability_snapshots_titleId"`);
        await queryRunner.query(`ALTER TABLE "availability_snapshots" DROP CONSTRAINT "FK_availability_snapshots_sourceRecordId"`);
        await queryRunner.query(`ALTER TABLE "availability_snapshots" DROP CONSTRAINT "FK_availability_snapshots_titleId"`);
        await queryRunner.query(`DROP TABLE "availability_snapshots"`);

        await queryRunner.query(`DROP INDEX "IDX_public_quality_sources_titleId"`);
        await queryRunner.query(`ALTER TABLE "public_quality_sources" DROP CONSTRAINT "FK_public_quality_sources_sourceRecordId"`);
        await queryRunner.query(`ALTER TABLE "public_quality_sources" DROP CONSTRAINT "FK_public_quality_sources_titleId"`);
        await queryRunner.query(`DROP TABLE "public_quality_sources"`);
    }

}
