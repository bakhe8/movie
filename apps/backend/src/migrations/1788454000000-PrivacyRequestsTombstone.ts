import { MigrationInterface, QueryRunner } from "typeorm";

// PRIVACY.md §5/§9/§10: a privacy request must survive as a tombstone after
// the user it names is deleted, but M2 gave privacy_requests.userId a NOT
// NULL FK with no ON DELETE action -- the tension SCHEMA.md §1 left "for
// whoever builds the delete flow to resolve deliberately". Resolved here,
// for the delete flow (ALPHA_PLAN phase 2, item 2.1):
//
// - userId becomes nullable and the FK is ON DELETE SET NULL, so the row
//   stays and stops pointing at anyone once the account is purged.
// - subjectKey is a SHA-256 of the user id, written on every request: a
//   pseudonymous key that links a user's requests to each other (and lets
//   an operator answer "was this account deleted, and when?" from the id
//   alone) without keeping the id itself after deletion -- "permanent record
//   without personal data" (PRIVACY.md §9).
// - profileId (bare uuid, no FK -- the profile is gone after a delete and
//   may be gone after a reset-then-wipe) records which profile a reset
//   request applied to.
export class PrivacyRequestsTombstone1788454000000 implements MigrationInterface {
    name = 'PrivacyRequestsTombstone1788454000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "privacy_requests" DROP CONSTRAINT "FK_privacy_requests_userId"`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" ALTER COLUMN "userId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" ADD CONSTRAINT "FK_privacy_requests_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" ADD "subjectKey" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" ADD "profileId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_privacy_requests_subjectKey" ON "privacy_requests" ("subjectKey")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.assertNoTombstones(queryRunner);
        await queryRunner.query(`DROP INDEX "IDX_privacy_requests_subjectKey"`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" DROP COLUMN "profileId"`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" DROP COLUMN "subjectKey"`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" DROP CONSTRAINT "FK_privacy_requests_userId"`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" ALTER COLUMN "userId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" ADD CONSTRAINT "FK_privacy_requests_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    // The rows PRIVACY.md §9 requires to outlive a deletion. Refuse, rather
    // than delete them silently as this rollback used to (AUDIT_2026-09-05
    // H6): an operator who really means to discard them does it explicitly,
    // on the record, before reverting.
    private async assertNoTombstones(queryRunner: QueryRunner): Promise<void> {
        const [{ count }] = (await queryRunner.query(
            `SELECT COUNT(*)::int AS count FROM "privacy_requests" WHERE "userId" IS NULL`,
        )) as [{ count: number }];
        if (count > 0) {
            throw new Error(
                `${this.name}.down(): ${count} tombstone row(s) in privacy_requests ("userId" IS NULL) would be destroyed by restoring NOT NULL; export or delete them explicitly before reverting.`,
            );
        }
    }

}
