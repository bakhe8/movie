import { MigrationInterface, QueryRunner } from 'typeorm';

// SEARCH-01 (remediation brief P1-01): catalogue search matched Latin titles
// byte for byte, so «Amelie» missed «Amélie» and «Rashomon» missed
// «Rashômon» -- the Latin half of the folding the Arabic half already had.
// `unaccent` is the contrib extension that strips those marks.
//
// Deliberately not fatal: CREATE EXTENSION needs a privileged role, and a
// deployment where the app's role cannot create it must still boot (boot
// contract, incident f23ec48). TitlesService probes pg_extension at runtime
// and simply leaves the accent-insensitive clause out when it is absent --
// search degrades to today's behaviour instead of the release failing.
export class AddUnaccentForSearch1788482000000 implements MigrationInterface {
  name = 'AddUnaccentForSearch1788482000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`);
    } catch (error) {
      console.warn(
        `[migration] unaccent extension not installed (${error instanceof Error ? error.message : String(error)}); ` +
          'catalogue search stays accent-sensitive for Latin titles until a privileged role installs it.',
      );
    }
  }

  // Left installed on purpose: an extension is database-wide, and dropping
  // it on a rollback would break anything else that came to depend on it.
  public async down(): Promise<void> {}
}
