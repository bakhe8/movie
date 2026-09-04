// Drops and recreates the `public` schema of the e2e test database before
// migrations run (board C-19). Needed since C-17: `moviedb_test` moved from
// a disposable tmpfs container (wiped on every container restart) into a
// database inside the durable dev Postgres volume, so debris from earlier
// runs now survives indefinitely -- 552 titles and 194 users accumulated
// this way, and are the likely cause of the intermittent
// training.e2e-spec.ts failure tracked with A and the coordinator.
require('../test/test-db-env.js');
const { Client } = require('pg');

const dbName = process.env.POSTGRES_DB;
if (!dbName || !dbName.endsWith('_test')) {
  throw new Error(`refusing to reset schema on a database not named *_test (got ${JSON.stringify(dbName)})`);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
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
