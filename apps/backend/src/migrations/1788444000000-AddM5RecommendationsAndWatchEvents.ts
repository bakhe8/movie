import { MigrationInterface, QueryRunner } from "typeorm";

// M5 of the migration plan (SCHEMA.md §2.4): persisted recommendations and
// the post-watch loop -- recommendations, outcomes, watch_events,
// library_imports. Schema only; RecommendationsService still returns scores
// computed per-request without writing a row anywhere (blueprint gap 4),
// and nothing writes a watch_events row either -- watches are still folded
// into user_title_states.watchedAt only.
export class AddM5RecommendationsAndWatchEvents1788444000000 implements MigrationInterface {
    name = 'AddM5RecommendationsAndWatchEvents1788444000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "library_imports" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "profileId" uuid NOT NULL,
                "status" character varying NOT NULL,
                "fileName" character varying,
                "rowCount" integer,
                "matchedCount" integer,
                "consentVersion" character varying NOT NULL,
                "rawDeletedAt" TIMESTAMP,
                "createdAt" TIMESTAMP,
                "completedAt" TIMESTAMP,
                CONSTRAINT "PK_library_imports" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "library_imports" ADD CONSTRAINT "FK_library_imports_profileId" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_library_imports_profileId" ON "library_imports" ("profileId")`);

        await queryRunner.query(`
            CREATE TABLE "recommendations" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "requestId" uuid NOT NULL,
                "profileId" uuid NOT NULL,
                "titleId" uuid NOT NULL,
                "track" character varying NOT NULL,
                "personalFit" real,
                "publicQuality" real,
                "watchability" real,
                "confidenceBand" character varying NOT NULL,
                "confidenceRaw" real,
                "reason" json NOT NULL,
                "evidenceSource" character varying NOT NULL DEFAULT 'individual',
                "candidateSource" character varying,
                "modelVersion" character varying NOT NULL,
                "policyVersion" character varying NOT NULL,
                "experimentId" character varying,
                "selectionPropensity" real,
                "shownAt" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_recommendations" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "recommendations" ADD CONSTRAINT "FK_recommendations_profileId" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recommendations" ADD CONSTRAINT "FK_recommendations_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_recommendations_profileId_createdAt" ON "recommendations" ("profileId", "createdAt" DESC)`);

        await queryRunner.query(`
            CREATE TABLE "outcomes" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "recommendationId" uuid NOT NULL,
                "type" character varying NOT NULL,
                "triadId" uuid,
                "rankPosition" integer,
                "occurredAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_outcomes" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "outcomes" ADD CONSTRAINT "FK_outcomes_recommendationId" FOREIGN KEY ("recommendationId") REFERENCES "recommendations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "outcomes" ADD CONSTRAINT "FK_outcomes_triadId" FOREIGN KEY ("triadId") REFERENCES "triads"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_outcomes_recommendationId" ON "outcomes" ("recommendationId")`);

        await queryRunner.query(`
            CREATE TABLE "watch_events" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "profileId" uuid NOT NULL,
                "titleId" uuid NOT NULL,
                "watchedAt" TIMESTAMP,
                "source" character varying NOT NULL,
                "editionId" uuid,
                "audioLanguage" character varying(5),
                "subtitleLanguage" character varying(5),
                "provider" character varying,
                "importId" uuid,
                "recommendationId" uuid,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_watch_events" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "watch_events" ADD CONSTRAINT "FK_watch_events_profileId" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "watch_events" ADD CONSTRAINT "FK_watch_events_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "watch_events" ADD CONSTRAINT "FK_watch_events_editionId" FOREIGN KEY ("editionId") REFERENCES "title_editions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "watch_events" ADD CONSTRAINT "FK_watch_events_recommendationId" FOREIGN KEY ("recommendationId") REFERENCES "recommendations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_watch_events_profileId" ON "watch_events" ("profileId")`);
        await queryRunner.query(`CREATE INDEX "IDX_watch_events_recommendationId" ON "watch_events" ("recommendationId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_watch_events_recommendationId"`);
        await queryRunner.query(`DROP INDEX "IDX_watch_events_profileId"`);
        await queryRunner.query(`ALTER TABLE "watch_events" DROP CONSTRAINT "FK_watch_events_recommendationId"`);
        await queryRunner.query(`ALTER TABLE "watch_events" DROP CONSTRAINT "FK_watch_events_editionId"`);
        await queryRunner.query(`ALTER TABLE "watch_events" DROP CONSTRAINT "FK_watch_events_titleId"`);
        await queryRunner.query(`ALTER TABLE "watch_events" DROP CONSTRAINT "FK_watch_events_profileId"`);
        await queryRunner.query(`DROP TABLE "watch_events"`);

        await queryRunner.query(`DROP INDEX "IDX_outcomes_recommendationId"`);
        await queryRunner.query(`ALTER TABLE "outcomes" DROP CONSTRAINT "FK_outcomes_triadId"`);
        await queryRunner.query(`ALTER TABLE "outcomes" DROP CONSTRAINT "FK_outcomes_recommendationId"`);
        await queryRunner.query(`DROP TABLE "outcomes"`);

        await queryRunner.query(`DROP INDEX "IDX_recommendations_profileId_createdAt"`);
        await queryRunner.query(`ALTER TABLE "recommendations" DROP CONSTRAINT "FK_recommendations_titleId"`);
        await queryRunner.query(`ALTER TABLE "recommendations" DROP CONSTRAINT "FK_recommendations_profileId"`);
        await queryRunner.query(`DROP TABLE "recommendations"`);

        await queryRunner.query(`DROP INDEX "IDX_library_imports_profileId"`);
        await queryRunner.query(`ALTER TABLE "library_imports" DROP CONSTRAINT "FK_library_imports_profileId"`);
        await queryRunner.query(`DROP TABLE "library_imports"`);
    }

}
