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
  },
});
