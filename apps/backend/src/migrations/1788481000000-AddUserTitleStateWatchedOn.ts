import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-104 (remediation brief P1-03/DATE-01): the calendar day a title was
// watched, as plain 'YYYY-MM-DD' text -- never a native date/timestamp
// column, so no driver or timezone can silently shift it (the bug this
// fixes: watchedAt stored the server's UTC "now", which reads as the
// previous day for anyone east of UTC acting just after their own
// midnight). Backfilled from the existing watchedAt's UTC date for rows
// already marked watched -- an approximation for history written before
// this column existed, since the user's actual local day cannot be
// recovered from a UTC timestamp alone; every row written from here on is
// exact, supplied by the client's own clock. Names follow ADR-91's
// convention.
export class AddUserTitleStateWatchedOn1788481000000 implements MigrationInterface {
  name = 'AddUserTitleStateWatchedOn1788481000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_title_states" ADD "watchedOn" character varying(10)`);
    await queryRunner.query(`
      UPDATE "user_title_states"
      SET "watchedOn" = to_char("watchedAt", 'YYYY-MM-DD')
      WHERE "watchedAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_title_states" DROP COLUMN "watchedOn"`);
  }
}
