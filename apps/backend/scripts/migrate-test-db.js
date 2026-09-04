// Resets the schema, then runs every migration from scratch against the e2e
// test database (`moviedb_test`, inside the shared dev Postgres instance
// since board C-17). Used by `npm run test:e2e` before the suite boots the
// app. The reset (board C-19) is what used to happen for free when this
// database lived in its own disposable tmpfs container -- debris from one
// run no longer wipes itself between runs otherwise.
const { execFileSync } = require('node:child_process');
execFileSync(process.execPath, [require.resolve('./reset-test-schema.js')], { stdio: 'inherit' });

require('../test/test-db-env.js');
process.argv = [process.argv[0], process.argv[1], '-d', 'src/data-source.ts', 'migration:run'];
require('./typeorm-cli.js');
