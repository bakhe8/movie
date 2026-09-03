import { MigrationInterface, QueryRunner } from "typeorm";

// Closes the remaining pieces of the M1 migration plan (SCHEMA.md §2.4):
// the naming exception (user_title_state -> user_title_states, ADR-16),
// users.role for the admin board (BP §5.1), profiles.pausedAt for the
// 'pause_all' privacy restriction (PRIVACY.md §4), and triads.holdout /
// correctsTriadId with their indexes (BP §8.3, §13.2, §16.1). The
// replacement endpoint and idempotency/event-completeness slices of M1
// already shipped ahead of this one (ADR-17, ADR-32).
export class CompleteM1Plan1788435000000 implements MigrationInterface {
    name = 'CompleteM1Plan1788435000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_title_state" RENAME TO "user_title_states"`);

        await queryRunner.query(`ALTER TABLE "users" ADD "role" character varying NOT NULL DEFAULT 'user'`);

        // NULL = not paused; set when the user invokes the 'pause_all'
        // restriction, cleared when they resume (PRIVACY.md §4). No
        // application logic reads this yet -- the column exists so it can.
        await queryRunner.query(`ALTER TABLE "profiles" ADD "pausedAt" TIMESTAMP`);

        // Self-referencing FK: a correction triad points at the triad it
        // corrects (BP §13.2, append-only corrections -- never an update).
        await queryRunner.query(`ALTER TABLE "triads" ADD "correctsTriadId" uuid`);
        await queryRunner.query(`ALTER TABLE "triads" ADD CONSTRAINT "FK_triads_correctsTriadId" FOREIGN KEY ("correctsTriadId") REFERENCES "triads"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        // Reserved for validation; no selection policy sets this true yet
        // (random-v1 has no held-out concept of its own -- BP §8.3, §16.1).
        await queryRunner.query(`ALTER TABLE "triads" ADD "holdout" boolean NOT NULL DEFAULT false`);

        await queryRunner.query(`CREATE INDEX "IDX_triads_profileId_createdAt" ON "triads" ("profileId", "createdAt")`);
        await queryRunner.query(`CREATE INDEX "IDX_triads_profileId_status" ON "triads" ("profileId", "status")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_triads_profileId_status"`);
        await queryRunner.query(`DROP INDEX "IDX_triads_profileId_createdAt"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "holdout"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP CONSTRAINT "FK_triads_correctsTriadId"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "correctsTriadId"`);
        await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "pausedAt"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
        await queryRunner.query(`ALTER TABLE "user_title_states" RENAME TO "user_title_state"`);
    }

}
