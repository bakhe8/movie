import { MigrationInterface, QueryRunner } from 'typeorm';

// AUDIT_2026-09-05 H7: embeddings, recommendations and watch_events each
// carry a foreign key to titles with no index on "titleId", so every
// title-scoped lookup -- and every cascading or checked title delete -- on
// what are expected to become the largest tables scanned the whole table.
// Additive only: three plain b-tree indexes, mirrored on the entities.
export class AddTitleIdIndexes1788468000000 implements MigrationInterface {
  name = 'AddTitleIdIndexes1788468000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_embeddings_titleId" ON "embeddings" ("titleId")`);
    await queryRunner.query(`CREATE INDEX "IDX_recommendations_titleId" ON "recommendations" ("titleId")`);
    await queryRunner.query(`CREATE INDEX "IDX_watch_events_titleId" ON "watch_events" ("titleId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_watch_events_titleId"`);
    await queryRunner.query(`DROP INDEX "IDX_recommendations_titleId"`);
    await queryRunner.query(`DROP INDEX "IDX_embeddings_titleId"`);
  }
}
