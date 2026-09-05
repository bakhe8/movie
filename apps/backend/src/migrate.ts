import 'reflect-metadata';
import { readFileSync } from 'fs';
import * as path from 'path';
import { AppDataSource } from './data-source';
import { CatalogRightsEntry, loadCatalogRights } from './scripts/load-catalog-rights';
import { refreshImdbRatings } from './scripts/load-imdb-ratings';
import { resolveFixturesDir, seedDemo } from './scripts/seed-demo';
import { captureException, initObservability } from './observability/observability';

// The release step (ADR-90): pending migrations, then the catalog and
// everything derived from it, in one process that exits when done.
//
//   node dist/migrate.js      (npm run release; `npm run migrate:prod` is the
//                              same entry under the name the live Railway
//                              service already calls)
//
// Compiled rather than the `typeorm` CLI (A-19): `scripts/typeorm-cli.js` is
// never copied into the runtime stage, it requires `ts-node` which `npm ci
// --omit=dev` leaves out, and it points at `src/data-source.ts`, which does
// not exist there either. Local development keeps the CLI (`npm run
// migrate`), which is what migration:generate needs anyway.
//
// After the schema, the catalog: `seed-demo --catalog-only` (titles and their
// provenance rows, never the @demo.local accounts), the rights-registry rows
// for the catalog's own fields, then IMDb ratings from the official dump.
// Every step is idempotent, so this runs on every deploy, and the committed
// fixture is the catalog's source of truth in every environment (owner rule
// 2026-09-05: the seed is part of the deployment, never a manual step). A
// step that fails stops the release, non-zero and loudly.
async function main(): Promise<void> {
  await initObservability();
  await AppDataSource.initialize();
  try {
    const applied = await AppDataSource.runMigrations();
    if (applied.length === 0) {
      console.log('[migrate] no pending migrations');
    }
    for (const migration of applied) {
      console.log(`[migrate] applied ${migration.name}`);
    }

    const log = (line: string) => console.log(`[release] ${line}`);
    const fixturesDir = resolveFixturesDir();
    const catalog = await seedDemo(AppDataSource, { fixturesDir, catalogOnly: true, log });
    log(
      `catalog: ${catalog.titlesUpserted} titles, ${catalog.contentFeatureRows} provenance rows ` +
        `(${catalog.contentFeatureRowsSuperseded} superseded)`,
    );

    const entries = JSON.parse(readFileSync(path.join(fixturesDir, 'catalog.demo.json'), 'utf8')) as CatalogRightsEntry[];
    const rights = await loadCatalogRights(AppDataSource, entries, { log });
    log(`rights: ${rights.rowsCreated} new row(s) across ${rights.titlesMatched} title(s), ${rights.rowsAlreadyLoaded} already loaded`);

    // P0-4: IMDb is out of the critical release path. refreshImdbRatings
    // already falls back to a previous good dump on a failed download
    // (load-imdb-ratings.ts's fetchDumpAtomic); this catch is for the one
    // case it cannot absorb -- no previous dump at all (a fresh volume) and
    // the network down -- so that even then, a schema migration or a
    // catalog reseed is never blocked by IMDb's dataset endpoint being
    // unreachable. The next successful deploy or scheduled refresh
    // (IMDB_REFRESH_INTERVAL_HOURS) fills the ratings in later.
    try {
      const imdb = await refreshImdbRatings(AppDataSource, { fetch: true, log });
      log(
        `imdb: ${imdb.created} rating(s) written for ${imdb.titlesWithImdbId} title(s), ` +
          `${imdb.unchanged} unchanged, ${imdb.superseded} superseded${imdb.stale ? ' [stale dump]' : ''}`,
      );
    } catch (error) {
      log(`imdb: refresh failed, continuing release without it: ${error instanceof Error ? error.message : String(error)}`);
      captureException(error, { job: 'imdb-release-refresh' });
    }
  } finally {
    // Always closed: this process is meant to exit, and a Railway service
    // with restartPolicyType NEVER would otherwise sit on an open pool.
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  // Non-zero, and loudly: a release step that fails quietly lets the next
  // deploy start against a schema or a catalog that is not there.
  console.error(`[release] failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
