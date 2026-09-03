import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// NestJS/TypeORM rely on `emitDecoratorMetadata`, which esbuild (Vite's
// default TS transform) does not emit. SWC's transform does, so it's swapped
// in here purely for the test run -- the actual build still uses tsc.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
