import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';

// Only apps/worker hosts Rivet actors, so only it imports rivetkit. Outside it, a client file may
// be named here on purpose. This list may grow only with a reviewed reason next to each entry.
const workspace_root = process.cwd();
const worker_root = 'apps/worker/';
const allowed_client_files = new Set([
  // The API's one typed adapter over rivetkit/client. The doorbell ring, the queue worker client
  // and a person's cancel all reach Rivet through it.
  'apps/api/src/services/events/rivet_actor_lookup.ts',
  // The web app's live chat socket to the session's queue worker (rivetkit/client only).
  'apps/app/src/lib/rivet_client.ts',
]);
const scanned_roots = ['apps', 'packages'];
const skipped_directories = new Set(['node_modules', 'dist', '.next', '.output', '.vercel']);
const source_extensions = ['.ts', '.tsx', '.mts', '.cts'];

type SourceFile = { relative_path: string; source_text: string };

async function main() {
  if (process.argv.includes('--self-test')) {
    run_self_test();
    return;
  }
  const files = await read_source_files();
  const violations = find_rivetkit_imports_outside_worker(files);
  if (violations.length > 0) {
    console.error('Rivetkit boundary FAIL: only apps/worker imports rivetkit.');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Rivetkit boundary PASS: checked ${files.length} TypeScript files.`);
}

function find_rivetkit_imports_outside_worker(files: SourceFile[]) {
  return files.flatMap((file) => {
    if (file.relative_path.startsWith(worker_root)) return [];
    if (allowed_client_files.has(file.relative_path)) return [];
    return read_module_specifiers(file)
      .filter(is_rivetkit_module)
      .map((specifier) => `${file.relative_path} imports "${specifier}"`);
  });
}

function is_rivetkit_module(specifier: string) {
  return (
    specifier === 'rivetkit' ||
    specifier.startsWith('rivetkit/') ||
    specifier.startsWith('@rivetkit/')
  );
}

async function read_source_files(): Promise<SourceFile[]> {
  const nested = await Promise.all(
    scanned_roots.map((root) => list_source_files(path.join(workspace_root, root))),
  );
  return Promise.all(
    nested.flat().map(async (file_path) => ({
      relative_path: path.relative(workspace_root, file_path).split(path.sep).join('/'),
      source_text: await readFile(file_path, 'utf8'),
    })),
  );
}

async function list_source_files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const child_path = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return skipped_directories.has(entry.name) ? [] : list_source_files(child_path);
      }
      const is_source = source_extensions.some((extension) => entry.name.endsWith(extension));
      return entry.isFile() && is_source && !entry.name.endsWith('.d.ts') ? [child_path] : [];
    }),
  );
  return nested.flat();
}

function read_module_specifiers(file: SourceFile) {
  const source = ts.createSourceFile(
    file.relative_path,
    file.source_text,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    const specifier = read_module_specifier(node);
    if (specifier) specifiers.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function read_module_specifier(node: ts.Node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  const is_dynamic_import =
    ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (is_dynamic_import && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
    return node.arguments[0].text;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    const { literal } = node.argument;
    if (ts.isStringLiteral(literal)) return literal.text;
  }
  return null;
}

function run_self_test() {
  const source_text = [
    "import { actor } from 'rivetkit';",
    "import { createClient } from 'rivetkit/client';",
    "export type T = import('@rivetkit/engine-cli').X;",
    "const later = () => import('rivetkit/test');",
    "import { z } from 'zod';",
  ].join('\n');
  const files = [
    { relative_path: 'packages/jobs/src/bad.ts', source_text },
    { relative_path: 'apps/worker/src/good.ts', source_text },
    { relative_path: 'apps/api/src/services/events/rivet_actor_lookup.ts', source_text },
  ];
  const violations = find_rivetkit_imports_outside_worker(files);
  const expected = 4;
  if (violations.length !== expected || violations.some((v) => !v.startsWith('packages/jobs/'))) {
    throw new Error(
      `Rivetkit boundary self-test failed: expected ${expected} violations in packages/jobs, got ${JSON.stringify(violations)}.`,
    );
  }
  console.log('Rivetkit boundary self-test PASS: imports outside apps/worker were rejected.');
}

main().catch((error: unknown) => {
  console.error(`Rivetkit boundary ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
