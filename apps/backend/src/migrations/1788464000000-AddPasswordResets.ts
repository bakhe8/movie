import { MigrationInterface, QueryRunner } from "typeorm";

// ALPHA_PLAN 3.2 / ADR-85: password reset by a time-limited, single-use
// link. Hashes only, cascading with the account like refresh_tokens.
export class AddPasswordResets1788464000000 implements MigrationInterface {
    name = 'AddPasswordResets1788464000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "password_resets" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" uuid NOT NULL,
                "tokenHash" character varying(64) NOT NULL,
                "expiresAt" TIMESTAMP NOT NULL,
                "usedAt" TIMESTAMP,
                "revokedAt" TIMESTAMP,
                "ipHash" character varying,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_password_resets" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "password_resets" ADD CONSTRAINT "FK_password_resets_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_password_resets_tokenHash" ON "password_resets" ("tokenHash")`);
        await queryRunner.query(`CREATE INDEX "IDX_password_resets_userId" ON "password_resets" ("userId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_password_resets_userId"`);
        await queryRunner.query(`DROP INDEX "IDX_password_resets_tokenHash"`);
        await queryRunner.query(`ALTER TABLE "password_resets" DROP CONSTRAINT "FK_password_resets_userId"`);
        await queryRunner.query(`DROP TABLE "password_resets"`);
    }

}
