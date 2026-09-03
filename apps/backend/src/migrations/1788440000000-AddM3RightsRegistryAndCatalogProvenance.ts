import { MigrationInterface, QueryRunner } from "typeorm";

// M3 of the migration plan (SCHEMA.md §2.4): the rights registry
// (source_records) and the catalog provenance/localization tables that
// depend on it -- localized_titles, title_editions, people, credits -- plus
// content_features, the per-feature provenance behind titles.fingerprint.
// Schema only; nothing populates these tables yet (that needs licensed
// sources and a real ingestion pass, blueprint gap 6/9).
export class AddM3RightsRegistryAndCatalogProvenance1788440000000 implements MigrationInterface {
    name = 'AddM3RightsRegistryAndCatalogProvenance1788440000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "people" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "externalIds" json,
                CONSTRAINT "PK_people" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "source_records" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid,
                "fieldName" character varying NOT NULL,
                "value" text,
                "source" character varying NOT NULL,
                "license" character varying,
                "licenseStatus" character varying NOT NULL,
                "allowsStorage" boolean,
                "allowsDerivation" boolean,
                "allowsTraining" boolean,
                "attributionRequired" boolean,
                "retentionUntil" TIMESTAMP,
                "fallbackPlan" character varying,
                "confidence" real,
                "extractorVersion" character varying,
                "reviewStatus" character varying,
                "supersededBy" uuid,
                "retrievedAt" TIMESTAMP,
                "validFrom" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_source_records" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "source_records" ADD CONSTRAINT "FK_source_records_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "source_records" ADD CONSTRAINT "FK_source_records_supersededBy" FOREIGN KEY ("supersededBy") REFERENCES "source_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_source_records_titleId" ON "source_records" ("titleId")`);

        await queryRunner.query(`
            CREATE TABLE "localized_titles" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "title" character varying NOT NULL,
                "language" character varying(5) NOT NULL,
                "region" character varying(2),
                "kind" character varying NOT NULL,
                "displayPriority" integer NOT NULL DEFAULT 0,
                "sourceRecordId" uuid,
                CONSTRAINT "PK_localized_titles" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "localized_titles" ADD CONSTRAINT "FK_localized_titles_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "localized_titles" ADD CONSTRAINT "FK_localized_titles_sourceRecordId" FOREIGN KEY ("sourceRecordId") REFERENCES "source_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_localized_titles_titleId" ON "localized_titles" ("titleId")`);
        await queryRunner.query(`CREATE INDEX "IDX_localized_titles_title_fts" ON "localized_titles" USING GIN (to_tsvector('simple', "title"))`);

        await queryRunner.query(`
            CREATE TABLE "title_editions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "kind" character varying NOT NULL,
                "audioLanguage" character varying(5),
                "subtitleLanguage" character varying(5),
                "notes" text,
                CONSTRAINT "PK_title_editions" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "title_editions" ADD CONSTRAINT "FK_title_editions_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_title_editions_titleId" ON "title_editions" ("titleId")`);

        await queryRunner.query(`
            CREATE TABLE "credits" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "personId" uuid NOT NULL,
                "role" character varying NOT NULL,
                "creditOrder" integer,
                "sourceRecordId" uuid,
                CONSTRAINT "PK_credits" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "credits" ADD CONSTRAINT "FK_credits_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "credits" ADD CONSTRAINT "FK_credits_personId" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "credits" ADD CONSTRAINT "FK_credits_sourceRecordId" FOREIGN KEY ("sourceRecordId") REFERENCES "source_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_credits_titleId" ON "credits" ("titleId")`);
        await queryRunner.query(`CREATE INDEX "IDX_credits_personId" ON "credits" ("personId")`);

        await queryRunner.query(`
            CREATE TABLE "content_features" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "featureKey" character varying NOT NULL,
                "value" real,
                "distribution" json,
                "uncertainty" real,
                "sourceIds" text array NOT NULL DEFAULT '{}',
                "extractorVersion" character varying NOT NULL,
                "licenseStatus" character varying NOT NULL,
                "reviewStatus" character varying NOT NULL,
                "validFrom" TIMESTAMP NOT NULL,
                "supersededBy" uuid,
                CONSTRAINT "UQ_content_features_titleId_featureKey_extractorVersion" UNIQUE ("titleId", "featureKey", "extractorVersion"),
                CONSTRAINT "PK_content_features" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "content_features" ADD CONSTRAINT "FK_content_features_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "content_features" ADD CONSTRAINT "FK_content_features_supersededBy" FOREIGN KEY ("supersededBy") REFERENCES "content_features"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "content_features" DROP CONSTRAINT "FK_content_features_supersededBy"`);
        await queryRunner.query(`ALTER TABLE "content_features" DROP CONSTRAINT "FK_content_features_titleId"`);
        await queryRunner.query(`DROP TABLE "content_features"`);

        await queryRunner.query(`DROP INDEX "IDX_credits_personId"`);
        await queryRunner.query(`DROP INDEX "IDX_credits_titleId"`);
        await queryRunner.query(`ALTER TABLE "credits" DROP CONSTRAINT "FK_credits_sourceRecordId"`);
        await queryRunner.query(`ALTER TABLE "credits" DROP CONSTRAINT "FK_credits_personId"`);
        await queryRunner.query(`ALTER TABLE "credits" DROP CONSTRAINT "FK_credits_titleId"`);
        await queryRunner.query(`DROP TABLE "credits"`);

        await queryRunner.query(`DROP INDEX "IDX_title_editions_titleId"`);
        await queryRunner.query(`ALTER TABLE "title_editions" DROP CONSTRAINT "FK_title_editions_titleId"`);
        await queryRunner.query(`DROP TABLE "title_editions"`);

        await queryRunner.query(`DROP INDEX "IDX_localized_titles_title_fts"`);
        await queryRunner.query(`DROP INDEX "IDX_localized_titles_titleId"`);
        await queryRunner.query(`ALTER TABLE "localized_titles" DROP CONSTRAINT "FK_localized_titles_sourceRecordId"`);
        await queryRunner.query(`ALTER TABLE "localized_titles" DROP CONSTRAINT "FK_localized_titles_titleId"`);
        await queryRunner.query(`DROP TABLE "localized_titles"`);

        await queryRunner.query(`DROP INDEX "IDX_source_records_titleId"`);
        await queryRunner.query(`ALTER TABLE "source_records" DROP CONSTRAINT "FK_source_records_supersededBy"`);
        await queryRunner.query(`ALTER TABLE "source_records" DROP CONSTRAINT "FK_source_records_titleId"`);
        await queryRunner.query(`DROP TABLE "source_records"`);

        await queryRunner.query(`DROP TABLE "people"`);
    }

}
