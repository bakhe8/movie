import { MigrationInterface, QueryRunner } from "typeorm";

// ADR-26: refresh tokens before Alpha (ALPHA_PLAN phase 3, item 3.1). New
// table only; nothing existing changes. Hashes, never tokens, are stored
// (see refresh-token.entity.ts). ON DELETE CASCADE from users so the
// privacy purge (PrivacyService) takes every session with the account.
export class AddRefreshTokens1788458000000 implements MigrationInterface {
    name = 'AddRefreshTokens1788458000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "refresh_tokens" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" uuid NOT NULL,
                "tokenHash" character varying(64) NOT NULL,
                "familyId" uuid NOT NULL,
                "expiresAt" TIMESTAMP NOT NULL,
                "revokedAt" TIMESTAMP,
                "revokedReason" character varying,
                "replacedById" uuid,
                "ipHash" character varying,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_refresh_tokens_tokenHash" ON "refresh_tokens" ("tokenHash")`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_familyId" ON "refresh_tokens" ("familyId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_familyId"`);
        await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_userId"`);
        await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_tokenHash"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_userId"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    }

}
