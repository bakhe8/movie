-- Runs once, automatically, only when docker/docker-compose.yml's `postgres`
-- service initializes a brand-new (empty) data volume -- Postgres only
-- executes /docker-entrypoint-initdb.d/* on first init, never on a volume
-- that already has data. Creates the second database the e2e test suite
-- uses (apps/backend/test/test-db-env.js), alongside the dev `moviedb`
-- database, inside the same container/instance (board C-17).
--
-- An existing volume from before C-17 needs this run once by hand instead:
--   docker exec movie-postgres psql -U movieapp -d moviedb -c "CREATE DATABASE moviedb_test"
CREATE DATABASE moviedb_test;
