import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, loadEnv } from 'vite';
import tsconfig_paths from 'vite-tsconfig-paths';

type BuildEnv = Record<string, string | undefined>;

// The client bundle keeps reading the `NEXT_PUBLIC_*` values off process.env (the names are
// shared with packages/config/public_env and the marketing app), so each key is statically
// replaced at build time. Vite has no process.env in the browser; `define` is the replacement
// mechanism.
const public_env_keys = [
  'NEXT_PUBLIC_ENVIRONMENT',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_MARKETING_URL',
  'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE',
];

function public_env_values_given_at_build(build_env: BuildEnv) {
  const define: Record<string, string> = {};
  for (const key of public_env_keys) {
    const value = build_env[key];
    if (value !== undefined) define[`process.env.${key}`] = JSON.stringify(value);
  }
  return define;
}

function public_env_keys_missing_at_build(build_env: BuildEnv) {
  const define: Record<string, string> = {};
  for (const key of public_env_keys) {
    if (build_env[key] === undefined) define[`process.env.${key}`] = 'undefined';
  }
  return define;
}

function sentry_build_plugins(build_env: BuildEnv) {
  const auth_token = build_env.SENTRY_AUTH_TOKEN;
  const org = build_env.SENTRY_ORG;
  const project = build_env.SENTRY_PROJECT;
  if (!auth_token || !org || !project) return [];

  const release_name = build_env.SENTRY_RELEASE ?? build_env.VERCEL_GIT_COMMIT_SHA;

  return sentryTanstackStart({
    org,
    project,
    authToken: auth_token,
    telemetry: false,
    silent: !build_env.SENTRY_DEBUG,
    ...(release_name ? { release: { name: release_name } } : {}),
    tunnelRoute: '/monitoring',
    sourcemaps: {
      filesToDeleteAfterUpload: [
        './dist/**/*.map',
        './.output/**/*.map',
        './.vercel/output/**/*.map',
      ],
    },
  });
}

// portless fronts the dev server with https://<worktree>.app.localhost on port 443. Vite's HMR
// client reads the page origin and would dial that host on the internal port, which nothing
// listens on, so point it at the proxy instead. UNTESTED: it needs a running portless proxy.
function portless_hmr_config(build_env: BuildEnv) {
  const portless_url = build_env.PORTLESS_URL;
  if (!portless_url) return {};
  const hmr = { protocol: 'wss', host: new URL(portless_url).hostname, clientPort: 443 };
  return { hmr };
}

export default defineConfig(({ mode }) => {
  const build_env: BuildEnv = loadEnv(mode, process.cwd(), '');
  return {
    define: public_env_values_given_at_build(build_env),
    environments: { client: { define: public_env_keys_missing_at_build(build_env) } },
    server: {
      port: Number(build_env.APP_PORT ?? build_env.PORT ?? 3000),
      host: build_env.COWORKER_TEST_LOGIN_ENABLED === 'true' ? '127.0.0.1' : '0.0.0.0',
      allowedHosts: ['.localhost', 'localhost'],
      ...portless_hmr_config(build_env),
    },
    plugins: [
      // Alias resolution is per-project: files inside a workspace package resolve `@shared/*`,
      // `@api/*`, etc. through their OWN tsconfig (all inherit the paths in tsconfig.base.json).
      // Listing only this app's tsconfig leaves imports inside packages/* unresolved in dev.
      tsconfig_paths({
        projects: [
          './tsconfig.json',
          '../api/tsconfig.json',
          '../../packages/agent-core/tsconfig.json',
          '../../packages/config/tsconfig.json',
          '../../packages/connectors/tsconfig.json',
          '../../packages/core/tsconfig.json',
          '../../packages/runtime-platform/tsconfig.json',
          '../../packages/shared/tsconfig.json',
          '../../packages/ui/tsconfig.json',
        ],
      }),
      tanstackStart(),
      // Nitro packages the server for the host it detects (Vercel from the VERCEL env, a plain
      // node server otherwise). Without it a Vercel deploy holds static files and no function,
      // and every route answers 404. Order follows vercel.com/docs/frameworks/full-stack/tanstack-start.
      // use-sync-external-store ships a CommonJS shim that calls require("react") at runtime, and
      // the bundler leaves that call in place, so react must travel inside the function as a real
      // package or every request fails with "Cannot find module 'react'".
      nitro({ traceDeps: ['react', 'react-dom'] }),
      // Must come after tanstackStart(): it rewrites the generated start entry and reads the
      // route tree. See node_modules/@sentry/tanstackstart-react/build/types/vite/
      // sentryTanstackStart.d.ts.
      ...sentry_build_plugins(build_env),
      react(),
    ],
  };
});
