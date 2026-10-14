import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { list_repository_files } from '@scripts/lib/list_repository_files';
import {
  assert_shrink_only_baseline_works,
  create_first_baseline,
  find_baseline_breaches,
  read_baseline,
  shrink_baseline,
  write_baseline,
  type ShrinkOnlyBaseline,
} from '@scripts/lib/shrink_only_baseline';
import { list_source_comments, type SourceComment } from '@scripts/ratchet/source_comments';
import { parse_source_file } from '@scripts/ratchet/syntax_walk';

const baseline_path = join(process.cwd(), 'scripts/check-no-comments-in-program-packages.baseline.json');
const program_package_roots = ['packages/memory/', 'packages/connectors/'];
const program_tool_directive_pattern =
  /^(?:biome-ignore|@ts-expect-error|@ts-ignore|@ts-nocheck|eslint-disable|eslint-enable|<reference\s|[#@]__PURE__|[#@]__NO_SIDE_EFFECTS__|@vitest-environment|@jsxImportSource)/u;
const program_license_header_pattern =
  /^(?:Copyright\b|\(c\)\s|©|SPDX-License-Identifier:|@license\b|Licensed under\b)|\bLicense:\s*\S/iu;

export type CommentViolation = { readonly line: number; readonly message: string };

export function is_program_package_file(repository_path: string): boolean {
  const is_typescript_file = repository_path.endsWith('.ts') || repository_path.endsWith('.tsx');
  return is_typescript_file && program_package_roots.some((root) => repository_path.startsWith(root));
}

function is_license_header(comment: SourceComment, source_text: string): boolean {
  const text_before_comment = source_text.slice(0, comment.position).replace(/^#!.*/u, '').trim();
  return text_before_comment === '' && program_license_header_pattern.test(comment.body);
}

function is_allowed_comment(comment: SourceComment, source_text: string): boolean {
  return program_tool_directive_pattern.test(comment.body) || is_license_header(comment, source_text);
}

export function find_comment_violations(source_text: string, file_path: string): CommentViolation[] {
  const source_file = parse_source_file(file_path, source_text);
  return list_source_comments(source_file)
    .filter((comment) => !is_allowed_comment(comment, source_text))
    .map((comment) => ({ line: comment.line, message: comment.body.split('\n')[0]?.slice(0, 70) ?? '' }));
}

function scan_program_packages(): Map<string, CommentViolation[]> {
  const violations_by_file = new Map<string, CommentViolation[]>();
  for (const repository_path of list_repository_files(is_program_package_file)) {
    const violations = find_comment_violations(readFileSync(repository_path, 'utf8'), repository_path);
    if (violations.length > 0) violations_by_file.set(repository_path, violations);
  }
  return violations_by_file;
}

function count_by_file(violations_by_file: Map<string, CommentViolation[]>): ShrinkOnlyBaseline {
  return Object.fromEntries([...violations_by_file].map(([file_path, violations]) => [file_path, violations.length]));
}

type SelfTestCase = { readonly name: string; readonly source_text: string; readonly expected_violations: number };

const self_test_cases: readonly SelfTestCase[] = [
  { name: 'a JSDoc block on an export', source_text: '/**\n * Explains f.\n */\nexport function f() {}\n', expected_violations: 1 },
  { name: 'a trailing line comment', source_text: 'const a = 1; // a note\n', expected_violations: 1 },
  { name: 'a line that names a ceiling', source_text: 'const a = 1;\n// One page only. Add paging past 100 rows.\n', expected_violations: 1 },
  { name: 'a top comment that names a license key', source_text: '// Parses the license key from the user record.\nconst a = 1;\n', expected_violations: 1 },
  { name: 'a copyright line below code', source_text: 'const a = 1;\n// Copyright 2026 Alfera.\n', expected_violations: 1 },
  { name: 'a biome-ignore directive', source_text: '// biome-ignore lint/style/noNonNullAssertion: narrowed above\nconst a = 1!;\n', expected_violations: 0 },
  { name: 'a @ts-expect-error directive', source_text: '// @ts-expect-error narrowing is checked above\nconst a: number = 1;\n', expected_violations: 0 },
  { name: 'a copyright license header', source_text: '// Copyright 2026 Alfera. MIT License.\nconst a = 1;\n', expected_violations: 0 },
  { name: 'an SPDX license header', source_text: '// SPDX-License-Identifier: MIT\nconst a = 1;\n', expected_violations: 0 },
  { name: 'a dataset source and license header', source_text: '// Source: https://example.com/data. License: MIT.\nconst a = 1;\n', expected_violations: 0 },
  { name: 'a string that holds //', source_text: "const a = 'a // b /* c */';\n", expected_violations: 0 },
  { name: 'a URL string', source_text: "const a = 'https://example.com/path';\n", expected_violations: 0 },
  { name: 'template text that holds //', source_text: 'const a = `x // y\n/* z */ ${1}`;\n', expected_violations: 0 },
  { name: 'a regex that holds //', source_text: 'const a = /\\/\\/x/u;\n', expected_violations: 0 },
];

function run_self_test(): void {
  assert_shrink_only_baseline_works();
  for (const test_case of self_test_cases) {
    const violations = find_comment_violations(test_case.source_text, 'packages/memory/src/sample.ts');
    if (violations.length !== test_case.expected_violations) {
      throw new Error(`self-test: ${test_case.name} gave ${violations.length} violations, want ${test_case.expected_violations}`);
    }
  }
  console.log('check-no-comments-in-program-packages self-test PASS');
}

function run_check(): void {
  const violations_by_file = scan_program_packages();
  const baseline = read_baseline(baseline_path);
  const breaches = find_baseline_breaches(baseline, count_by_file(violations_by_file));
  if (breaches.length === 0) {
    console.log(`check-no-comments-in-program-packages: no new comments; ${Object.keys(baseline).length} files baselined`);
    return;
  }
  console.error(
    'A comment in packages/memory or packages/connectors drifts from the code and nobody keeps it updated.\n' +
      'Move its meaning into a function or variable name. Only a tool directive (biome-ignore, @ts-expect-error,\n' +
      'eslint-disable, ...) or a license header may stay:',
  );
  for (const breach of breaches) {
    for (const violation of violations_by_file.get(breach.repository_path) ?? []) {
      console.error(`  ${breach.repository_path}:${violation.line}: ${violation.message}`);
    }
  }
  process.exitCode = 1;
}

function run_update(): void {
  const shrunk = shrink_baseline(read_baseline(baseline_path), count_by_file(scan_program_packages()));
  write_baseline(baseline_path, shrunk);
  console.log(`check-no-comments-in-program-packages: baseline now holds ${Object.keys(shrunk).length} files`);
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) run_self_test();
else if (argv.includes('--create-baseline')) create_first_baseline(baseline_path, count_by_file(scan_program_packages()));
else if (argv.includes('--update')) run_update();
else run_check();
