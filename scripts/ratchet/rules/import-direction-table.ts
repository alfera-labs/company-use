export type BrowserShipping = 'never' | 'every_src_file_except_server_files' | 'use_client_files_only';

export type ImportUnit = {
  readonly may_import: readonly string[];
  readonly may_import_types_only: readonly string[];
  readonly test_may_import: readonly string[];
  readonly ships_to_browser: BrowserShipping;
};

export const import_units: Readonly<Record<string, ImportUnit>> = {
  'packages/shared': {
    may_import: [],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'every_src_file_except_server_files',
  },
  'packages/config': {
    may_import: [],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'every_src_file_except_server_files',
  },
  'packages/integrations': {
    may_import: ['packages/shared'],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'every_src_file_except_server_files',
  },
  'packages/ui': {
    may_import: ['packages/shared'],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'every_src_file_except_server_files',
  },
  'packages/agent-core': {
    may_import: ['packages/shared'],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'packages/core': {
    may_import: ['packages/config', 'packages/memory', 'packages/shared'],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'packages/connectors': {
    may_import: ['packages/core', 'packages/shared'],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'packages/jobs': {
    may_import: ['packages/config', 'packages/core', 'packages/shared'],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'packages/memory': {
    may_import: [],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'packages/runtime-platform': {
    may_import: [
      'packages/agent-core',
      'packages/config',
      'packages/connectors',
      'packages/core',
      'packages/jobs',
      'packages/memory',
      'packages/shared',
    ],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'packages/evals': {
    may_import: [
      'apps/api',
      'packages/agent-core',
      'packages/config',
      'packages/core',
      'packages/jobs',
      'packages/memory',
      'packages/runtime-platform',
      'packages/shared',
    ],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'apps/api': {
    may_import: [
      'packages/agent-core',
      'packages/config',
      'packages/connectors',
      'packages/core',
      'packages/jobs',
      'packages/memory',
      'packages/runtime-platform',
      'packages/shared',
    ],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'apps/worker': {
    may_import: [
      'apps/api',
      'packages/agent-core',
      'packages/config',
      'packages/connectors',
      'packages/core',
      'packages/jobs',
      'packages/memory',
      'packages/runtime-platform',
      'packages/shared',
    ],
    may_import_types_only: [],
    test_may_import: [],
    ships_to_browser: 'never',
  },
  'apps/app': {
    may_import: ['packages/config', 'packages/shared', 'packages/ui'],
    may_import_types_only: ['apps/api'],
    test_may_import: [],
    ships_to_browser: 'every_src_file_except_server_files',
  },
};

export const server_only_file_patterns: readonly RegExp[] = [
  /\.server\.[cm]?tsx?$/u,
  /^apps\/app\/src\/server\.ts$/u,
  /^apps\/app\/src\/instrumentation_node\.ts$/u,
];

export const server_only_marker_specifiers: readonly string[] = ['@tanstack/react-start/server-only', 'server-only'];

export const server_only_entry_specifiers: readonly string[] = ['@coworker/config', '@coworker/config/env'];

export const server_only_npm_packages: readonly string[] = [
  '@dotenvx/dotenvx',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@google-cloud/scheduler',
  '@hono/node-server',
  '@sentry/node',
  '@slack/web-api',
  '@workos-inc/node',
  'drizzle-orm',
  'e2b',
  'openai',
  'postgres',
  'posthog-node',
  'stripe',
];
