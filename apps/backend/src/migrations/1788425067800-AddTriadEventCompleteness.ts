import { MigrationInterface, QueryRunner } from "typeorm";

// Gap 3 (IMPLEMENTATION_STATUS.md, ADR-32): triads gains shownAt/answeredAt/
// modelVersion as first-class columns (out of the metadata JSON blob),
// an idempotencyKey for POST /triads/:id/rank retries (BP §14), and its
// ranking column moves from index-based (integer[], positions into
// titleIds) to title-id-based (uuid[], ADR-15) -- ranking now says *which
// films*, not which array slots, so it survives independently of
// titleIds' order and matches what the API accepts.
export class AddTriadEventCompleteness1788425067800 implements MigrationInterface {
    name = 'AddTriadEventCompleteness1788425067800'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "triads" ADD "shownAt" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "triads" ADD "answeredAt" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "triads" ADD "modelVersion" character varying`);
        await queryRunner.query(`ALTER TABLE "triads" ADD "idempotencyKey" uuid`);
        await queryRunner.query(`ALTER TABLE "triads" ADD CONSTRAINT "UQ_triads_idempotencyKey" UNIQUE ("idempotencyKey")`);

        // createdAt "doubled as shownAt" before this migration (SCHEMA.md) --
        // make that explicit for existing rows rather than leaving them NULL.
        await queryRunner.query(`UPDATE "triads" SET "shownAt" = "createdAt"`);

        // ranking: integer[] (positions into titleIds) -> uuid[] (the title
        // ids themselves, in ranked order). Postgres arrays are 1-indexed,
        // and ranking's values are 0-indexed, hence the +1.
        await queryRunner.query(`ALTER TABLE "triads" ADD "rankingTitleIds" uuid[]`);
        await queryRunner.query(`
            UPDATE "triads"
            SET "rankingTitleIds" = ARRAY[
                "titleIds"[ranking[1] + 1],
                "titleIds"[ranking[2] + 1],
                "titleIds"[ranking[3] + 1]
            ]
            WHERE ranking IS NOT NULL
        `);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "ranking"`);
        await queryRunner.query(`ALTER TABLE "triads" RENAME COLUMN "rankingTitleIds" TO "ranking"`);
        // answeredAt is left NULL for triads completed before this migration --
        // no recorded moment to backfill honestly (unknown, not fabricated).
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "triads" ADD "rankingIndices" integer[]`);
        await queryRunner.query(`
            UPDATE "triads"
            SET "rankingIndices" = ARRAY[
                array_position("titleIds", ranking[1]) - 1,
                array_position("titleIds", ranking[2]) - 1,
                array_position("titleIds", ranking[3]) - 1
            ]
            WHERE ranking IS NOT NULL
        `);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "ranking"`);
        await queryRunner.query(`ALTER TABLE "triads" RENAME COLUMN "rankingIndices" TO "ranking"`);

        await queryRunner.query(`ALTER TABLE "triads" DROP CONSTRAINT "UQ_triads_idempotencyKey"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "idempotencyKey"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "modelVersion"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "answeredAt"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "shownAt"`);
    }

}
