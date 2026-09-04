// Drops and recreates the `public` schema of the e2e test database before
// migrations run (board C-19). Needed since C-17: `moviedb_test` moved from
// a disposable tmpfs container (wiped on every container restart) into a
// database inside the durable dev Postgres volume, so debris from earlier
// runs now survives indefinitely -- 552 titles and 194 users accumulated
// this way, and are the likely cause of the intermittent
// training.e2e-spec.ts failure tracked with A and the coordinator.
require('../test/test-db-env.js');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
// Parse the actual database name out of DATABASE_URL itself -- checking
// POSTGRES_DB here was the bug (AUDIT_2026-09-05 C3): test-db-env.js always
// sets POSTGRES_DB to 'moviedb_test' regardless of what DATABASE_URL
// resolves to, and a DATABASE_URL exported in the operator's own shell
// silently wins over the composed test URL. A shell pointed at the shared
// dev database would then pass a POSTGRES_DB check while DROP SCHEMA
// CASCADE ran for real against dev -- the same class of accident as A-14,
// this time destructive rather than additive.
const dbName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
if (!dbName || !dbName.endsWith('_test')) {
  throw new Error(`refusing to reset schema on a database not named *_test (got ${JSON.stringify(dbName)} from DATABASE_URL)`);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log(`Reset schema on ${dbName}.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
