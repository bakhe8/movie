// Runs pending migrations against the disposable e2e test database
// (docker/docker-compose.yml's `postgres-test` service). Used by
// `npm run test:e2e` before the suite boots the app.
require('../test/test-db-env.js');
process.argv = [process.argv[0], process.argv[1], '-d', 'src/data-source.ts', 'migration:run'];
require('./typeorm-cli.js');
