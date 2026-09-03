import { MigrationInterface, QueryRunner } from "typeorm";

// ADR-17 (blueprint §4.3, §13.1): the two neutral replacement controls on the
// triad screen -- "haven't watched" / "don't remember" -- get their own
// append-only event table, and user_title_state gains the triadEligible flag
// that "don't remember" clears. Neither reason ever enters a loss, prior or
// score (SPECIFICATION.md §2 row 3): these rows are exposure bookkeeping and
// a Phase 0/Alpha metric (replacement rate), never a preference signal.
export class AddTriadReplacements1788428400000 implements MigrationInterface {
    name = 'AddTriadReplacements1788428400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // "Don't remember" keeps the title watched (it is not recommendable)
        // but takes it out of the triad pool. Every existing row is eligible.
        await queryRunner.query(`ALTER TABLE "user_title_state" ADD "triadEligible" boolean NOT NULL DEFAULT true`);

        await queryRunner.query(`CREATE TABLE "triad_replacements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "triadId" uuid NOT NULL, "replacedTitleId" uuid NOT NULL, "replacementTitleId" uuid, "reason" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_triad_replacements" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_triad_replacements_triadId" ON "triad_replacements" ("triadId")`);
        await queryRunner.query(`ALTER TABLE "triad_replacements" ADD CONSTRAINT "FK_triad_replacements_triadId" FOREIGN KEY ("triadId") REFERENCES "triads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "triad_replacements" ADD CONSTRAINT "FK_triad_replacements_replacedTitleId" FOREIGN KEY ("replacedTitleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        // replacementTitleId is NULL when the eligible pool had nothing left
        // and the triad was skipped instead of patched.
        await queryRunner.query(`ALTER TABLE "triad_replacements" ADD CONSTRAINT "FK_triad_replacements_replacementTitleId" FOREIGN KEY ("replacementTitleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "triad_replacements" DROP CONSTRAINT "FK_triad_replacements_replacementTitleId"`);
        await queryRunner.query(`ALTER TABLE "triad_replacements" DROP CONSTRAINT "FK_triad_replacements_replacedTitleId"`);
        await queryRunner.query(`ALTER TABLE "triad_replacements" DROP CONSTRAINT "FK_triad_replacements_triadId"`);
        await queryRunner.query(`DROP INDEX "IDX_triad_replacements_triadId"`);
        await queryRunner.query(`DROP TABLE "triad_replacements"`);
        await queryRunner.query(`ALTER TABLE "user_title_state" DROP COLUMN "triadEligible"`);
    }

}
