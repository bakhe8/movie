import { MigrationInterface, QueryRunner } from "typeorm";

// TriadsService.getCurrent() checks for an existing active triad and creates
// one when there is none; without a DB-level constraint, two concurrent
// requests for the same profile can both pass that check and both insert an
// 'active' row. A partial unique index makes the database the source of
// truth -- the loser of the race gets a unique-violation, which
// TriadsService.getCurrent() now catches and turns into "return the row the
// winner just created" instead of a duplicate.
export class AddOneActiveTriadPerProfileConstraint1788421102891 implements MigrationInterface {
    name = 'AddOneActiveTriadPerProfileConstraint1788421102891'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_triads_one_active_per_profile" ON "triads" ("profileId") WHERE status = 'active'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_triads_one_active_per_profile"`);
    }

}
