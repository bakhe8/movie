import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/test-db-env.js'],
    // App bootstrap + a real Postgres connection per test file is slower
    // than in-memory unit tests.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // One file at a time. These specs share two things no amount of
    // per-test hygiene can separate: one `postgres-test` database, and one
    // `process.env` (vitest's worker threads share the process). Both have
    // produced real, repeated flakes -- `training.e2e-spec.ts` and
    // `full-journey.e2e-spec.ts` each set MODEL_SERVICE_URL for their own
    // app, so in parallel one file's client can be built pointing at the
    // other's service; and candidate-pool assertions saw titles other files
    // had just inserted. Serial costs about a minute and buys a suite whose
    // red actually means something.
    fileParallelism: false,
  },
});
