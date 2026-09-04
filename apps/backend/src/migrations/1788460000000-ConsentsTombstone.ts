import { MigrationInterface, QueryRunner } from "typeorm";

// PRIVACY.md §9 groups consents with privacy requests: "permanent record
// without personal data after deletion". privacy_requests got that treatment
// in PrivacyRequestsTombstone; consents still cascaded away with the account
// (M2's ON DELETE CASCADE), so the record of what a user had agreed to
// vanished with them -- the one thing that record exists to answer. Same
// resolution as its neighbour (board F5, ADR-73's open item): userId goes
// nullable with ON DELETE SET NULL, and subjectKey (sha256 of the user id,
// indexed) keeps a purged user's consents linked to each other without
// keeping the id itself.
export class ConsentsTombstone1788460000000 implements MigrationInterface {
    name = 'ConsentsTombstone1788460000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "consents" DROP CONSTRAINT "FK_consents_userId"`);
        await queryRunner.query(`ALTER TABLE "consents" ALTER COLUMN "userId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "consents" ADD CONSTRAINT "FK_consents_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "consents" ADD "subjectKey" character varying(64)`);
        await queryRunner.query(`CREATE INDEX "IDX_consents_subjectKey" ON "consents" ("subjectKey")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.assertNoTombstones(queryRunner);
        await queryRunner.query(`DROP INDEX "IDX_consents_subjectKey"`);
        await queryRunner.query(`ALTER TABLE "consents" DROP COLUMN "subjectKey"`);
        await queryRunner.query(`ALTER TABLE "consents" DROP CONSTRAINT "FK_consents_userId"`);
        await queryRunner.query(`ALTER TABLE "consents" ALTER COLUMN "userId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "consents" ADD CONSTRAINT "FK_consents_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    // The rows PRIVACY.md §9 requires to outlive a deletion. Refuse, rather
    // than delete them silently as this rollback used to (AUDIT_2026-09-05
    // H6): an operator who really means to discard them does it explicitly,
    // on the record, before reverting.
    private async assertNoTombstones(queryRunner: QueryRunner): Promise<void> {
        const [{ count }] = (await queryRunner.query(
            `SELECT COUNT(*)::int AS count FROM "consents" WHERE "userId" IS NULL`,
        )) as [{ count: number }];
        if (count > 0) {
            throw new Error(
                `${this.name}.down(): ${count} tombstone row(s) in consents ("userId" IS NULL) would be destroyed by restoring NOT NULL; export or delete them explicitly before reverting.`,
            );
        }
    }

}
