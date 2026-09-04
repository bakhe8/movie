// Single source of truth for the e2e test database connection.
// Required BEFORE `../src/config/database.config.ts` (and therefore
// `../src/modules/app/app.module.ts`) is imported anywhere, so it must be
// loaded from a vitest `setupFiles` entry, not from inside a spec file.
//
// database.config.ts loads `.env` with `override: false`, so anything this
// file sets here wins over whatever is in the real .env -- the e2e suite
// never touches your dev database.
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5544';
process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'movieapp';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'test_password';
process.env.POSTGRES_DB = process.env.POSTGRES_DB || 'moviedb_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';

// DATABASE_URL now outranks the DB_* variables in database.config.ts (A-14),
// because the Python trainer and every loader script read only DATABASE_URL
// and one .env must not be able to point the two halves of the repo at two
// different databases. Which means the .env's dev URL would otherwise win
// here and quietly run the whole e2e suite against the dev database. So it is
// composed from the test values above -- unless the operator set one in their
// own shell, which this file has not run early enough to distinguish from
// anything except .env (dotenv has not been loaded yet at this point).
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}` +
    `@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.POSTGRES_DB}`;

module.exports = {};
