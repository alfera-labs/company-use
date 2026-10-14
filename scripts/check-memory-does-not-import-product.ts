import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';
import { read_module_specifiers } from '@scripts/lib/read_module_specifiers';

/*
 * Guard: packages/memory imports no product code; the host passes every capability as a port.
 * Why: one import of @coworker/core, @coworker/config, @runtime-platform, @api, apps/, @connectors
 * or rivetkit drags product schema, env and services into every standalone (PGlite, MCP) install.
 * Instead: add a port to MemoryDependencies (contracts/dependencies.ts) and let the host pass it.
 * Counts imports, exports, `import()`, `require()` and `vi.mock`, by prefix or by resolved path.
 */

type TsconfigPathMap = Readonly<Record<string, readonly string[]>>;
type SourceFileForScan = { file_path: string; source_text: string };

const workspace_root = process.cwd();
const memory_root = path.resolve(workspace_root, 'packages/memory');
const own_package_name = '@coworker/memory';
const product_prefixes = ['@coworker', '@runtime-platform', '@api', '@connectors', 'rivetkit'];
const product_roots = ['apps', 'packages'].map((root) => path.resolve(workspace_root, root));

async function main() {
  const tsconfig_paths = read_tsconfig_paths();
  if (process.argv.includes('--self-test')) return run_self_test(tsconfig_paths);
  const files = await read_memory_source_files();
  const violations = find_product_imports(files, tsconfig_paths);
  for (const { file_path, import_source, reason } of violations) {
    const file = path.relative(workspace_root, file_path);
    console.error(`- ${file} imports "${import_source}" (${reason})`);
  }
  if (violations.length === 0) {
    console.log(`Memory import boundary PASS: checked ${files.length} TypeScript files.`);
    return;
  }
  console.error('Memory import boundary FAIL. Instead: add a port to MemoryDependencies.');
  process.exitCode = 1;
}

function read_tsconfig_paths(): TsconfigPathMap {
  const tsconfig_path = path.resolve(workspace_root, 'tsconfig.base.json');
  const { config, error } = ts.readConfigFile(tsconfig_path, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  return config?.compilerOptions?.paths ?? {};
}

async function read_memory_source_files(): Promise<SourceFileForScan[]> {
  const file_paths = await list_type_script_files(memory_root);
  const read_one = async (file_path: string) => ({
    file_path,
    source_text: await readFile(file_path, 'utf8'),
  });
  return Promise.all(file_paths.map(read_one));
}

async function list_type_script_files(directory: string): Promise<string[]> {
  const relative_paths = await readdir(directory, { recursive: true });
  return relative_paths
    .filter((relative_path) => !relative_path.split(path.sep).includes('node_modules'))
    .filter((relative_path) => /\.[cm]?tsx?$/u.test(relative_path))
    .map((relative_path) => path.join(directory, relative_path))
    .sort();
}

function find_product_imports(files: readonly SourceFileForScan[], paths: TsconfigPathMap) {
  return files.flatMap((file) =>
    read_module_specifiers(file).flatMap((import_source) => {
      const reason = find_violation_reason(file.file_path, import_source, paths);
      return reason ? [{ file_path: file.file_path, import_source, reason }] : [];
    }),
  );
}

function find_violation_reason(file_path: string, import_source: string, paths: TsconfigPathMap) {
  if (import_source === own_package_name || import_source.startsWith(`${own_package_name}/`)) {
    return null;
  }
  const product_prefix = product_prefixes.find(
    (prefix) => import_source === prefix || import_source.startsWith(`${prefix}/`),
  );
  if (product_prefix) return `product prefix ${product_prefix}`;
  const resolved_paths = import_source.startsWith('.')
    ? [path.resolve(path.dirname(file_path), import_source)]
    : resolve_alias_targets(import_source, paths);
  const is_product_path = (candidate: string) =>
    !is_inside(candidate, memory_root) && product_roots.some((root) => is_inside(candidate, root));
  const outside_path = resolved_paths.find(is_product_path);
  return outside_path ? `resolves to ${path.relative(workspace_root, outside_path)}` : null;
}

function resolve_alias_targets(import_source: string, paths: TsconfigPathMap): string[] {
  return Object.entries(paths).flatMap(([alias_pattern, target_patterns]) => {
    const wildcard_value = match_alias_pattern(alias_pattern, import_source);
    if (wildcard_value === null) return [];
    return target_patterns.map((target) =>
      path.resolve(workspace_root, target.replace('*', wildcard_value)),
    );
  });
}

function match_alias_pattern(alias_pattern: string, import_source: string): string | null {
  const wildcard_index = alias_pattern.indexOf('*');
  if (wildcard_index === -1) return alias_pattern === import_source ? '' : null;
  const prefix = alias_pattern.slice(0, wildcard_index);
  const suffix = alias_pattern.slice(wildcard_index + 1);
  if (!import_source.startsWith(prefix) || !import_source.endsWith(suffix)) return null;
  return import_source.slice(prefix.length, import_source.length - suffix.length);
}

function is_inside(candidate_path: string, parent_path: string): boolean {
  const relative_path = path.relative(parent_path, candidate_path);
  if (relative_path === '') return true;
  return !relative_path.startsWith('..') && !path.isAbsolute(relative_path);
}

const self_test_bad_lines = [
  "import { db } from '@coworker/core';",
  "import type { Env } from '@coworker/config';",
  "export { create_id } from '@coworker/shared';",
  "import { run } from '@runtime-platform/orchestrator/runtime_orchestrator';",
  "const routes = await import('@api/routes/brain/mcp');",
  "type Tool = import('@connectors/index').Tool;",
  "vi.mock('@coworker/core/db', () => ({}));",
  "import { actor } from 'rivetkit';",
  "import { server } from '../../../../apps/api/src/server';",
  "import { schema } from '../../../core/src/db/schema/index';",
  "import { near_miss } from '@coworker/memoryx';",
];

const self_test_good_lines = [
  "import { create_memory } from '@coworker/memory';",
  "import type { ScopeKey } from '@coworker/memory/contracts/keys';",
  "import { z } from 'zod';",
  "import type { PgDatabase } from 'drizzle-orm/pg-core';",
  "import { PGlite } from '@electric-sql/pglite';",
  "import { createServer } from 'node:http';",
  "import { keys } from '../contracts/keys';",
];

function count_violations(lines: readonly string[], paths: TsconfigPathMap): number {
  const file_path = path.join(memory_root, 'src/folders/synthetic_import.ts');
  return find_product_imports([{ file_path, source_text: lines.join('\n') }], paths).length;
}

function run_self_test(paths: TsconfigPathMap) {
  const missed = self_test_bad_lines.filter((line) => count_violations([line], paths) !== 1);
  const wrongly_rejected = self_test_good_lines.filter((line) => count_violations([line], paths));
  const failures = [
    ...missed.map((line) => `missed: ${line}`),
    ...wrongly_rejected.map((line) => `wrongly rejected: ${line}`),
  ];
  if (failures.length > 0) throw new Error(`self-test failed. ${failures.join(' | ')}`);
  const counts = `${self_test_bad_lines.length} rejected, ${self_test_good_lines.length} kept`;
  console.log(`Memory import boundary self-test PASS: ${counts}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Memory import boundary ERROR: ${message}`);
  process.exitCode = 1;
});
