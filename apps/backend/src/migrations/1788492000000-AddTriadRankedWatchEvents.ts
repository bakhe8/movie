import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-119: triads.rank() confirms its three titles as watched (a ranking is
// stronger evidence than the exposure list ever was) and records why via the
// existing watch_events log rather than a parallel table -- 'triad_ranked'
// joins 'in_app' | 'import' | 'manual' as a source, linked back to the triad
// through this new nullable column. ON DELETE SET NULL, not CASCADE: the
// append-only exposure record must outlive the triad row it cites, even
// though nothing deletes a triad today. The partial unique index (only when
// triadId IS NOT NULL) keeps one row per (triad, title) without touching the
// unrelated rows every other source already writes with triadId always NULL.
export class AddTriadRankedWatchEvents1788492000000 implements MigrationInterface {
  name = 'AddTriadRankedWatchEvents1788492000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "watch_events" ADD "triadId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "watch_events" ADD CONSTRAINT "FK_watch_events_triadId" FOREIGN KEY ("triadId") REFERENCES "triads"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_watch_events_triadId" ON "watch_events" ("triadId")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_watch_events_triadId_titleId" ON "watch_events" ("triadId", "titleId") WHERE "triadId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_watch_events_triadId_titleId"`);
    await queryRunner.query(`DROP INDEX "IDX_watch_events_triadId"`);
    await queryRunner.query(`ALTER TABLE "watch_events" DROP CONSTRAINT "FK_watch_events_triadId"`);
    await queryRunner.query(`ALTER TABLE "watch_events" DROP COLUMN "triadId"`);
  }
}
