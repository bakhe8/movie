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

module.exports = {};
