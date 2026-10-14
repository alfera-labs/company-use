import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';

type TsconfigPathMap = Record<string, readonly string[]>;

type SourceFileForScan = {
  file_path: string;
  source_text: string;
};

type ProductImportViolation = {
  file_path: string;
  import_source: string;
  resolved_path?: string;
};

// The job engine is product-blind. It may use core, config, and shared. It never reaches into
// the product packages that register handlers or serve the API.
const workspace_root = process.cwd();
const jobs_source_root = path.resolve(workspace_root, 'packages/jobs');
const product_import_prefixes = ['@runtime-platform', '@coworker/runtime-platform', '@api'];
const product_roots = [
  path.resolve(workspace_root, 'apps'),
  path.resolve(workspace_root, 'packages/runtime-platform'),
];

async function main() {
  const tsconfig_paths = await read_tsconfig_paths();

  if (process.argv.includes('--self-test')) {
    run_self_test(tsconfig_paths);
    return;
  }

  const files = await read_jobs_source_files();
  const violations = find_product_imports(files, tsconfig_paths);

  if (violations.length > 0) {
    console.error('Jobs import boundary FAIL: the job engine imports product code.');
    for (const violation of violations) {
      const resolved = violation.resolved_path
        ? ` -> ${relative_workspace_path(violation.resolved_path)}`
        : '';
      console.error(
        `- ${relative_workspace_path(violation.file_path)} imports "${violation.import_source}"${resolved}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Jobs import boundary PASS: checked ${files.length} TypeScript files.`);
}

async function read_tsconfig_paths(): Promise<TsconfigPathMap> {
  const tsconfig_path = path.resolve(workspace_root, 'tsconfig.base.json');
  const parsed = JSON.parse(await readFile(tsconfig_path, 'utf8')) as {
    compilerOptions?: { paths?: TsconfigPathMap };
  };

  return parsed.compilerOptions?.paths ?? {};
}

async function read_jobs_source_files() {
  const file_paths = await list_type_script_files(jobs_source_root);
  return Promise.all(
    file_paths.map(async (file_path): Promise<SourceFileForScan> => {
      return {
        file_path,
        source_text: await readFile(file_path, 'utf8'),
      };
    }),
  );
}

async function list_type_script_files(directory: string): Promise<string[]> {
  const dir_entries = await readdir(directory, { withFileTypes: true });
  const nested_files = await Promise.all(
    dir_entries.map(async (dir_entry): Promise<string[]> => {
      const child_path = path.join(directory, dir_entry.name);
      if (dir_entry.isDirectory() && dir_entry.name !== 'node_modules') {
        return list_type_script_files(child_path);
      }
      if (dir_entry.isFile() && child_path.endsWith('.ts')) return [child_path];
      return [];
    }),
  );

  return nested_files.flat().sort();
}

function find_product_imports(
  files: SourceFileForScan[],
  tsconfig_paths: TsconfigPathMap,
): ProductImportViolation[] {
  return files.flatMap((file) =>
    read_module_specifiers(file).flatMap((import_source) => {
      const violation = find_product_import(file.file_path, import_source, tsconfig_paths);
      return violation ? [violation] : [];
    }),
  );
}

function read_module_specifiers(file: SourceFileForScan) {
  const source_file = ts.createSourceFile(
    file.file_path,
    file.source_text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const module_specifiers: string[] = [];

  const visit = (node: ts.Node) => {
    const module_specifier = read_module_specifier(node);
    if (module_specifier) module_specifiers.push(module_specifier);
    ts.forEachChild(node, visit);
  };

  visit(source_file);
  return module_specifiers;
}

function read_module_specifier(node: ts.Node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }

  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword || is_vitest_mock_call(node)) &&
    node.arguments.length > 0
  ) {
    const [argument] = node.arguments;
    if (argument && ts.isStringLiteral(argument)) return argument.text;
  }

  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    const { literal } = node.argument;
    if (ts.isStringLiteral(literal)) return literal.text;
  }

  return null;
}

// A test that mocks a product module still ties the engine to that module.
function is_vitest_mock_call(node: ts.CallExpression) {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'vi' &&
    ['mock', 'doMock'].includes(node.expression.name.text)
  );
}

function find_product_import(
  file_path: string,
  import_source: string,
  tsconfig_paths: TsconfigPathMap,
): ProductImportViolation | null {
  const product_prefix = product_import_prefixes.find(
    (prefix) => import_source === prefix || import_source.startsWith(`${prefix}/`),
  );
  if (product_prefix) return { file_path, import_source };

  const resolved_paths = import_source.startsWith('.')
    ? [path.resolve(path.dirname(file_path), import_source)]
    : resolve_alias_targets(import_source, tsconfig_paths);
  const resolved_path = resolved_paths.find((candidate) =>
    product_roots.some((product_root) => path_is_inside(candidate, product_root)),
  );
  return resolved_path ? { file_path, import_source, resolved_path } : null;
}

function resolve_alias_targets(import_source: string, tsconfig_paths: TsconfigPathMap) {
  return Object.entries(tsconfig_paths).flatMap(([alias_pattern, target_patterns]) => {
    const wildcard_value = match_alias_pattern(alias_pattern, import_source);
    if (wildcard_value === null) return [];

    return target_patterns.map((target_pattern) =>
      path.resolve(workspace_root, target_pattern.replace('*', wildcard_value)),
    );
  });
}

function match_alias_pattern(alias_pattern: string, import_source: string) {
  if (!alias_pattern.includes('*')) return alias_pattern === import_source ? '' : null;

  const wildcard_index = alias_pattern.indexOf('*');
  const prefix = alias_pattern.slice(0, wildcard_index);
  const suffix = alias_pattern.slice(wildcard_index + 1);
  if (!import_source.startsWith(prefix)) return null;
  if (!import_source.endsWith(suffix)) return null;

  return import_source.slice(prefix.length, import_source.length - suffix.length);
}

function path_is_inside(candidate_path: string, parent_path: string) {
  const relative_path = path.relative(parent_path, candidate_path);
  return (
    relative_path === '' || (!relative_path.startsWith('..') && !path.isAbsolute(relative_path))
  );
}

function relative_workspace_path(file_path: string) {
  return path.relative(workspace_root, file_path).split(path.sep).join('/');
}

function run_self_test(tsconfig_paths: TsconfigPathMap) {
  const synthetic_file_path = path.resolve(
    workspace_root,
    'packages/jobs/src/synthetic_bad_import.ts',
  );
  const bad_imports = [
    '@runtime-platform/events/event_job_handler_registry',
    '@coworker/runtime-platform',
    '@api/services/events/event_job_recovery',
    '../../../apps/api/src/server',
    '../../runtime-platform/src/index',
  ];
  const good_imports = ['@coworker/core', '@coworker/config', '@coworker/shared'];
  const violations = find_product_imports(
    [
      {
        file_path: synthetic_file_path,
        source_text: [...bad_imports, ...good_imports]
          .map((import_source) => `import '${import_source}';`)
          .join('\n'),
      },
    ],
    tsconfig_paths,
  );

  const rejected = new Set(violations.map((violation) => violation.import_source));
  const missed = bad_imports.filter((import_source) => !rejected.has(import_source));
  const wrongly_rejected = good_imports.filter((import_source) => rejected.has(import_source));

  if (missed.length > 0 || wrongly_rejected.length > 0) {
    throw new Error(
      `Jobs import boundary self-test failed. Missed: ${missed.join(', ') || 'none'}. Wrongly rejected: ${wrongly_rejected.join(', ') || 'none'}.`,
    );
  }

  console.log('Jobs import boundary self-test PASS: synthetic product imports were rejected.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Jobs import boundary ERROR: ${message}`);
  process.exitCode = 1;
});
