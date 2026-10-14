import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root_dir = fileURLToPath(new URL('.', import.meta.url));

// `@/` resolves into the dashboard (apps/app), the one app that owns it in its tsconfig.
const at_alias_app_dirs = ['apps/app/src'];
const module_extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx', ''];

function resolve_at_alias(source: string, importer: string | undefined): string {
  for (const app_dir of at_alias_app_dirs) {
    const base = `${root_dir}${app_dir}/${source}`;
    const found = module_extensions.find((extension) => existsSync(base + extension));
    if (found !== undefined) return base + found;
  }
  // Nothing on disk: hand back the dashboard path so the failure names a real path.
  return `${root_dir}apps/app/src/${source}`;
}

export default defineConfig({
  oxc: {
    // `'react-jsx'` is a tsconfig spelling, not an oxc one: oxc takes `'preserve'` or a
    // JSX options object. Files under a tsconfig let the invalid string slide, but a file
    // with no tsconfig above it (anything at the repo root) fails to transform at all.
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: [
      { find: /^@agent-core$/, replacement: `${root_dir}packages/agent-core/src/index.ts` },
      {
        find: /^@agent-core\/coding$/,
        replacement: `${root_dir}packages/agent-core/src/coding/index.ts`,
      },
      {
        find: /^@agent-core\/engines$/,
        replacement: `${root_dir}packages/agent-core/src/engines/index.ts`,
      },
      {
        find: /^@agent-core\/engines\/pi$/,
        replacement: `${root_dir}packages/agent-core/src/engines/pi/index.ts`,
      },
      {
        find: /^@agent-core\/environment$/,
        replacement: `${root_dir}packages/agent-core/src/environment/index.ts`,
      },
      {
        find: /^@agent-core\/events$/,
        replacement: `${root_dir}packages/agent-core/src/events/index.ts`,
      },
      {
        find: /^@agent-core\/messages$/,
        replacement: `${root_dir}packages/agent-core/src/messages/index.ts`,
      },
      {
        find: /^@agent-core\/models$/,
        replacement: `${root_dir}packages/agent-core/src/models/index.ts`,
      },
      {
        find: /^@agent-core\/runs$/,
        replacement: `${root_dir}packages/agent-core/src/runs/index.ts`,
      },
      {
        find: /^@agent-core\/tools$/,
        replacement: `${root_dir}packages/agent-core/src/tools/index.ts`,
      },
      { find: /^@agent-core\/(.*)$/, replacement: `${root_dir}packages/agent-core/src/$1` },
      // `customResolver` is the only hook Vitest 4 actually consults for this
      // rewrite: a `plugins` entry with an `enforce: 'pre'` resolveId hook (the
      // documented replacement) never fires for these imports. Revisit when Vite 9
      // drops the option.
      {
        find: /^@\/(.*)$/,
        replacement: '$1',
        customResolver: (source, importer) => resolve_at_alias(source, importer),
      },
      { find: /^@api$/, replacement: `${root_dir}apps/api/src` },
      { find: /^@api\/(.*)$/, replacement: `${root_dir}apps/api/src/$1` },
      { find: /^@connectors$/, replacement: `${root_dir}packages/connectors/src/index.ts` },
      { find: /^@connectors\/(.*)$/, replacement: `${root_dir}packages/connectors/src/$1` },
      {
        find: /^@coworker\/connectors$/,
        replacement: `${root_dir}packages/connectors/src/index.ts`,
      },
      { find: /^@coworker\/config$/, replacement: `${root_dir}packages/config/src/env.ts` },
      {
        find: /^@coworker\/config\/constants$/,
        replacement: `${root_dir}packages/config/src/constants.ts`,
      },
      {
        find: /^@coworker\/config\/env$/,
        replacement: `${root_dir}packages/config/src/env.ts`,
      },
      {
        find: /^@coworker\/config\/public_env$/,
        replacement: `${root_dir}packages/config/src/public_env.ts`,
      },
      { find: /^@coworker\/core$/, replacement: `${root_dir}packages/core/src/index.ts` },
      { find: /^@coworker\/core\/auth$/, replacement: `${root_dir}packages/core/src/auth.ts` },
      {
        find: /^@coworker\/core\/db$/,
        replacement: `${root_dir}packages/core/src/db/index.ts`,
      },
      {
        find: /^@coworker\/core\/db\/schema$/,
        replacement: `${root_dir}packages/core/src/db/schema/index.ts`,
      },
      {
        find: /^@coworker\/core\/db\/schema\/common$/,
        replacement: `${root_dir}packages/core/src/db/schema/common.ts`,
      },
      {
        find: /^@coworker\/core\/db\/schema\/core$/,
        replacement: `${root_dir}packages/core/src/db/schema/core.ts`,
      },
      {
        find: /^@coworker\/core\/db\/(.*)$/,
        replacement: `${root_dir}packages/core/src/db/$1`,
      },
      { find: /^@coworker\/jobs$/, replacement: `${root_dir}packages/jobs/src/index.ts` },
      { find: /^@coworker\/jobs\/(.*)$/, replacement: `${root_dir}packages/jobs/src/$1` },
      { find: /^@coworker\/memory$/, replacement: `${root_dir}packages/memory/src/index.ts` },
      { find: /^@coworker\/memory\/(.*)$/, replacement: `${root_dir}packages/memory/src/$1` },
      { find: /^@worker\/(.*)$/, replacement: `${root_dir}apps/worker/src/$1` },
      {
        find: /^@coworker\/runtime-platform$/,
        replacement: `${root_dir}packages/runtime-platform/src/index.ts`,
      },
      {
        find: /^@runtime-platform$/,
        replacement: `${root_dir}packages/runtime-platform/src`,
      },
      {
        find: /^@runtime-platform\/(.*)$/,
        replacement: `${root_dir}packages/runtime-platform/src/$1`,
      },
      { find: /^@coworker\/shared$/, replacement: `${root_dir}packages/shared/src/index.ts` },
      { find: /^@shared$/, replacement: `${root_dir}packages/shared/src` },
      { find: /^@shared\/(.*)$/, replacement: `${root_dir}packages/shared/src/$1` },
    ],
  },
  test: {
    // Tests must be hermetic: default the workspace runtime to the in-process "local"
    // provider so a turn never shells out to a real docker daemon. Without this the
    // default is "docker" (see packages/config/src/env.ts), which makes the Slack event
    // drain test spin up a container and time out on CI runners. Set here (before
    // @coworker/config parses env) since t3-env reads process.env once at import.
    env: {
      COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'local',
      EVENT_JOB_DISPATCH_MODE: 'in_process',
      EVENT_JOB_RECOVERY_MODE: 'interval',
      // The managed email channel needs a receiving domain; a test value keeps address
      // building and inbound routing exercisable without real DNS. RESEND_API_KEY is pinned
      // empty so a test that forgets to stub fetch fails with a named error instead of
      // sending real mail with a developer's key.
      INBOUND_EMAIL_DOMAIN: 'inbox.test.alfera.ai',
      RESEND_API_KEY: '',
    },
    deps: {
      // Bun reports `__esModule` on every ES module namespace. Vitest's default-export interop
      // then swaps a package namespace for its default export: `import { z } from 'zod'` became
      // undefined. Bun's own import already applies the `__esModule` rule, so skip it on Bun.
      interopDefault: !process.versions.bun,
    },
    setupFiles: [`${root_dir}vitest.setup.ts`],
    include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**', 'tests/e2e/**', '**/dist/**', '**/.next/**'],
    testTimeout: 15_000,
  },
});
