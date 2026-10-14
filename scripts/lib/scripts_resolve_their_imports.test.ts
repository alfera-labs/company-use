// Every repo script runs with `bun scripts/<name>.ts` from the repo root. A bare package that only a
// workspace package depends on (drizzle-orm lives in packages/core) does not resolve from scripts/,
// so the script crashes at start. Scripts reach such packages through a workspace import instead.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as ts from 'typescript';

const repository_root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function list_script_files(): string[] {
  const output = execFileSync('git', ['ls-files', '--', 'scripts/*.ts', 'scripts/**/*.ts'], {
    cwd: repository_root,
    encoding: 'utf8',
  });
  return output.split('\n').filter((file_path) => file_path && !file_path.endsWith('.d.ts'));
}

function list_runtime_imports(file_path: string): string[] {
  const source_text = readFileSync(join(repository_root, file_path), 'utf8');
  const source_file = ts.createSourceFile(file_path, source_text, ts.ScriptTarget.Latest, true);
  return source_file.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return [];
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) return [];
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) return [];
    const specifier = statement.moduleSpecifier;
    return specifier && ts.isStringLiteral(specifier) ? [specifier.text] : [];
  });
}

function find_unresolved_imports(file_path: string): string[] {
  const resolve_from_script = createRequire(join(repository_root, file_path)).resolve;
  return list_runtime_imports(file_path).filter((specifier) => {
    try {
      resolve_from_script(specifier);
      return false;
    } catch {
      return true;
    }
  });
}

describe('repo scripts', () => {
  it('resolve every runtime import from scripts/', () => {
    const unresolved = list_script_files().flatMap((file_path) =>
      find_unresolved_imports(file_path).map((specifier) => `${file_path}: ${specifier}`),
    );
    assert.deepEqual(unresolved, []);
  });
});
