import { MigrationInterface, QueryRunner } from 'typeorm';

// PUB-S1 (ADR-118): `title_revisions` holds one immutable content snapshot
// per accepted change; `titles."publishedRevisionId"` is the only pointer
// any public read path may follow. Schema only -- nothing writes a revision
// or sets the pointer yet. The shadow evaluator (PublicationPolicyService)
// computes readiness against a title's *current* row so a preview exists
// before any snapshot does; PUB-B1 is what actually starts inserting rows
// here and PUB-G1 is the only later step allowed to set the pointer.
//
// `publishedRevisionId` starts and stays NULL for every existing title:
// this migration must not make anything newly visible or hidden on any
// public surface, and does not by itself either.
export class AddTitleRevisions1788496000000 implements MigrationInterface {
  name = 'AddTitleRevisions1788496000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "title_revisions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "titleId" uuid NOT NULL,
                "titleEn" character varying NOT NULL,
                "titleAr" character varying NOT NULL,
                "description" character varying,
                "posterPath" character varying,
                "genres" text,
                "releaseYear" integer,
                "sourceRecordIds" uuid[] NOT NULL DEFAULT '{}',
                "policyVersion" character varying NOT NULL,
                "blockerCodes" text[] NOT NULL DEFAULT '{}',
                "evaluatedAt" TIMESTAMP NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_title_revisions" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `ALTER TABLE "title_revisions" ADD CONSTRAINT "FK_title_revisions_titleId" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_title_revisions_titleId" ON "title_revisions" ("titleId")`);

    await queryRunner.query(`ALTER TABLE "titles" ADD "publishedRevisionId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "titles" ADD CONSTRAINT "FK_titles_publishedRevisionId" FOREIGN KEY ("publishedRevisionId") REFERENCES "title_revisions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "titles" DROP CONSTRAINT "FK_titles_publishedRevisionId"`);
    await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "publishedRevisionId"`);
    await queryRunner.query(`DROP INDEX "IDX_title_revisions_titleId"`);
    await queryRunner.query(`DROP TABLE "title_revisions"`);
  }
}
