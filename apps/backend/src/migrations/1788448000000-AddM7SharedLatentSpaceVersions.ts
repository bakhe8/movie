import { MigrationInterface, QueryRunner } from "typeorm";

// M7 of the migration plan (SCHEMA.md §2.4) -- the last step -- but only
// its first half: shared_latent_space_versions (BP §7.5), plus the FK
// constraint on user_model_snapshots.calibratedAgainst that M4 deferred
// (ADR-54) because this table didn't exist yet.
//
// The plan's other M7 item -- converting embeddings.vector from real[] to
// pgvector's vector(n) with an IVFFLAT index -- is deliberately NOT done
// here. Unlike every other column/table in this seven-step plan, SCHEMA.md
// §2.2 gives no literal DDL for it, because no document or code in this
// repository commits to an embedding dimension: no embedding-generation
// code exists anywhere (services/workers never calls an embeddings API),
// and the table is empty in every environment. Picking a dimension now
// would be inventing a product/vendor decision (which embedding model,
// hence cost and lock-in) with zero grounding. Asked the user directly
// (2026-09-03); decided to defer this half of M7 rather than guess.
export class AddM7SharedLatentSpaceVersions1788448000000 implements MigrationInterface {
    name = 'AddM7SharedLatentSpaceVersions1788448000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "shared_latent_space_versions" (
                "version" character varying NOT NULL,
                "nFactors" integer,
                "seedDataSources" json NOT NULL DEFAULT '[]',
                "trainingCohortSize" integer,
                "acceptanceGateMetrics" json,
                "active" boolean NOT NULL DEFAULT false,
                "createdAt" TIMESTAMP,
                CONSTRAINT "PK_shared_latent_space_versions" PRIMARY KEY ("version")
            )
        `);

        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD CONSTRAINT "FK_user_model_snapshots_calibratedAgainst" FOREIGN KEY ("calibratedAgainst") REFERENCES "shared_latent_space_versions"("version") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP CONSTRAINT "FK_user_model_snapshots_calibratedAgainst"`);
        await queryRunner.query(`DROP TABLE "shared_latent_space_versions"`);
    }

}
