import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConnectionOptions } from './database.config';

// A-14's root cause. `services/workers/*.py` and every loader script connect
// through DATABASE_URL and nothing else; the backend read only DB_HOST /
// DB_PORT / POSTGRES_*. One .env could therefore point the two halves of the
// repo at two different databases, which is how a load run wrote 160 accounts
// into the shared dev database while its operator was setting DATABASE_URL to
// the test one.
describe('getConnectionOptions', () => {
  // Only these keys are touched and only these are put back. Vitest worker
  // threads share one `process.env`, so reassigning the whole object here
  // would clobber whatever a concurrently running file had set -- the same
  // class of cross-file bug that made the e2e suite flaky.
  const KEYS = ['DATABASE_URL', 'DB_HOST', 'DB_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'] as const;
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    for (const key of KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('reads DATABASE_URL when it is set', () => {
    process.env.DATABASE_URL = 'postgresql://someone:secret@127.0.0.1:5544/moviedb_test';

    expect(getConnectionOptions()).toMatchObject({
      host: '127.0.0.1',
      port: 5544,
      username: 'someone',
      password: 'secret',
      database: 'moviedb_test',
    });
  });

  // The exact trap: DATABASE_URL pointed at the test database while the DB_*
  // variables still named the dev one. Whichever wins, it must be the same
  // one Python uses -- and Python only knows DATABASE_URL.
  it('lets DATABASE_URL win over the DB_* variables rather than silently ignoring it', () => {
    process.env.DATABASE_URL = 'postgresql://movieapp:test_password@127.0.0.1:5544/moviedb_test';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '5433';
    process.env.POSTGRES_DB = 'moviedb';
    process.env.POSTGRES_PASSWORD = 'dev_password';

    expect(getConnectionOptions()).toMatchObject({ port: 5544, database: 'moviedb_test' });
  });

  it('still falls back to the DB_* variables when DATABASE_URL is unset', () => {
    process.env.DB_HOST = 'db.internal';
    process.env.DB_PORT = '5433';
    process.env.POSTGRES_DB = 'moviedb';
    process.env.POSTGRES_PASSWORD = 'dev_password';

    expect(getConnectionOptions()).toMatchObject({
      host: 'db.internal',
      port: 5433,
      database: 'moviedb',
      password: 'dev_password',
    });
  });

  it('decodes a password with URL-escaped characters instead of connecting with the escapes', () => {
    process.env.DATABASE_URL = 'postgresql://movieapp:p%40ss%2Fword@localhost:5432/moviedb_test';

    expect(getConnectionOptions().password).toBe('p@ss/word');
  });

  // Failing loudly beats falling back to DB_* and connecting somewhere the
  // operator did not intend -- which is the whole failure this guards.
  it.each(['not-a-url', 'mysql://user:pass@localhost:3306/db'])('refuses a DATABASE_URL of %j', (value) => {
    process.env.DATABASE_URL = value;
    process.env.DB_HOST = 'localhost';
    process.env.POSTGRES_PASSWORD = 'dev_password';

    expect(() => getConnectionOptions()).toThrow(/DATABASE_URL/);
  });

  // The first Railway deploy failed with a bare ECONNREFUSED to 127.0.0.1:5433
  // -- a stale local DB_PORT and no DATABASE_URL. A deployed app that resolves
  // to loopback is talking to itself, never to a database.
  describe('production loopback guard', () => {
    const savedNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.POSTGRES_PASSWORD = 'whatever';
    });

    afterEach(() => {
      process.env.NODE_ENV = savedNodeEnv;
    });

    it.each([
      ['a stale DB_HOST/DB_PORT', { DB_HOST: '127.0.0.1', DB_PORT: '5433' }],
      ['nothing set at all, defaulting to localhost', {}],
      ['a DATABASE_URL that itself points at loopback', { DATABASE_URL: 'postgresql://u:p@localhost:5432/moviedb' }],
    ])('refuses to start in production with %s', (_case, values) => {
      Object.assign(process.env, values);

      expect(() => getConnectionOptions()).toThrow(/Refusing to start/);
    });

    it('names DATABASE_URL as the fix, since that is the one variable to set', () => {
      process.env.DB_HOST = '127.0.0.1';

      expect(() => getConnectionOptions()).toThrow(/DATABASE_URL/);
    });

    it('allows a real host', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@postgres.railway.internal:5432/moviedb';

      expect(getConnectionOptions().host).toBe('postgres.railway.internal');
    });

    // Local development runs against 127.0.0.1 by design; the guard is only
    // about a deployed process.
    it('leaves local development alone', () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_HOST = '127.0.0.1';
      process.env.DB_PORT = '5433';

      expect(getConnectionOptions()).toMatchObject({ host: '127.0.0.1', port: 5433 });
    });
  });

  it('still requires a password when neither source supplies one', () => {
    process.env.DB_HOST = 'localhost';

    expect(() => getConnectionOptions()).toThrow(/POSTGRES_PASSWORD/);
  });
});
