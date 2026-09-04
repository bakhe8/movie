import { MigrationInterface, QueryRunner } from 'typeorm';

// AUDIT_2026-09-05 M4: shared_latent_space_versions.createdAt was a bare
// nullable TIMESTAMP with no default, while the entity declares it
// @CreateDateColumn and every sibling table's equivalent is NOT NULL DEFAULT
// now() -- drift a raw INSERT could exploit to leave a version undated. The
// table has never held a row in any environment; the backfill is there so
// the NOT NULL cannot fail on one that does.
export class SharedLatentSpaceVersionsCreatedAt1788470000000 implements MigrationInterface {
  name = 'SharedLatentSpaceVersionsCreatedAt1788470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "shared_latent_space_versions" SET "createdAt" = now() WHERE "createdAt" IS NULL`);
    await queryRunner.query(`ALTER TABLE "shared_latent_space_versions" ALTER COLUMN "createdAt" SET DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "shared_latent_space_versions" ALTER COLUMN "createdAt" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shared_latent_space_versions" ALTER COLUMN "createdAt" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "shared_latent_space_versions" ALTER COLUMN "createdAt" DROP DEFAULT`);
  }
}
