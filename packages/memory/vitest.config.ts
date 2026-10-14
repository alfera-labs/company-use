import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const package_dir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: package_dir,
  resolve: {
    alias: [
      { find: /^@coworker\/memory$/, replacement: `${package_dir}src/index.ts` },
      { find: /^@coworker\/memory\/(.*)$/, replacement: `${package_dir}src/$1` },
    ],
  },
  test: {
    deps: {
      interopDefault: !process.versions.bun,
    },
    setupFiles: [],
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 15_000,
  },
});
