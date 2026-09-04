import 'reflect-metadata';
import { AppDataSource } from './data-source';

// The production migrate step (A-19). The `typeorm` CLI path this replaces
// cannot run in the built image at all: `scripts/typeorm-cli.js` is never
// copied into the runtime stage, it requires `ts-node` which `npm ci
// --omit=dev` leaves out, and it points the CLI at `src/data-source.ts`,
// which does not exist there either. Three failures behind one
// `Cannot find module` -- so this is a compiled entry point that lands in
// dist/ with everything else and needs none of them.
//
//   node dist/migrate.js      (npm run migrate:prod)
//
// Local development keeps the CLI (`npm run migrate`), which is what
// migration:generate needs anyway.
async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const applied = await AppDataSource.runMigrations();
    if (applied.length === 0) {
      console.log('[migrate] no pending migrations');
    }
    for (const migration of applied) {
      console.log(`[migrate] applied ${migration.name}`);
    }
  } finally {
    // Always closed: this process is meant to exit, and a Railway service
    // with restartPolicyType NEVER would otherwise sit on an open pool.
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  // Non-zero, and loudly: a migrate step that fails quietly lets the next
  // deploy start against a schema that is not there.
  console.error(`[migrate] failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
