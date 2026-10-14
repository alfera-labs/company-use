import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { list_repository_files } from '@scripts/lib/list_repository_files';
import {
  assert_shrink_only_baseline_works,
  create_first_baseline,
  find_baseline_breaches,
  read_baseline,
  type ShrinkOnlyBaseline,
  shrink_baseline,
  write_baseline,
} from '@scripts/lib/shrink_only_baseline';
import * as ts from 'typescript';

/*
 * Guard: a live test or eval never points at a real workspace by id.
 *
 * A live test talks to real services with real accounts. Pointed at a real workspace, it sees
 * that workspace's connected Drive, Slack and mail, and a test that can write will find and
 * change real, shared files. Live tests create their own workspace instead
 * (bootstrap_default_workspace / bootstrap_live_test_workspace against the test database).
 * Existing eval scripts that still hard-code one are baselined and may only shrink.
 */

const baseline_path = join(process.cwd(), 'scripts/baselines/live-test-workspaces.baseline.json');
const workspace_id_literal = /\bws_\d+\b/u;

// Files that run against real services: *_live tests, eval harnesses, and live/stress scripts.
export function is_live_test_file(repository_path: string) {
  if (repository_path === 'scripts/check-live-tests-use-test-workspaces.ts') return false;
  return (
    /(^|\/)[^/]+_live\.test\.tsx?$/u.test(repository_path) ||
    /^packages\/evals\/src\/.+\.tsx?$/u.test(repository_path) ||
    /^scripts\/[^/]*(eval|live|stress|smoke)[^/]*\.(ts|mts|mjs)$/iu.test(repository_path)
  );
}

// Only code counts — string and template literals. Comments are left to the comment guard.
export function find_workspace_id_literals(file_name: string, source: string) {
  const source_file = ts.createSourceFile(file_name, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    const is_literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (is_literal && workspace_id_literal.test(node.text)) {
      lines.push(source_file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source_file);
  return lines;
}

function scan_live_test_files() {
  const lines_by_file = new Map<string, number[]>();
  for (const repository_path of list_repository_files(is_live_test_file)) {
    const lines = find_workspace_id_literals(
      repository_path,
      readFileSync(repository_path, 'utf8'),
    );
    if (lines.length > 0) lines_by_file.set(repository_path, lines);
  }
  return lines_by_file;
}

function count_by_file(lines_by_file: Map<string, number[]>): ShrinkOnlyBaseline {
  return Object.fromEntries([...lines_by_file].map(([path, lines]) => [path, lines.length]));
}

function run_self_test() {
  assert_shrink_only_baseline_works();
  const scope: [string, boolean][] = [
    ['packages/runtime-platform/src/__tests__/e2b_live.test.ts', true],
    ['packages/evals/src/slack_live_runner.ts', true],
    ['scripts/eval-scenarios.ts', true],
    ['scripts/brain_recall_eval.ts', true],
    ['packages/runtime-platform/src/channels/slack/turn_live_status.ts', false],
    ['apps/api/src/lib/sentry.test.ts', false],
  ];
  for (const [repository_path, expected] of scope) {
    if (is_live_test_file(repository_path) !== expected) {
      throw new Error(`self-test: ${repository_path} live scope should be ${expected}`);
    }
  }
  const planted = [
    "const WS = 'ws_2';",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: planted source text
    'await fetch(`${api}/v1/workspaces/ws_123/files`);',
    '// ws_2 is only mentioned in a comment here',
    "const bootstrap = await bootstrap_default_workspace(db); const id = 'ws_x';",
  ].join('\n');
  const lines = find_workspace_id_literals('planted_live.test.ts', planted);
  if (lines.join(',') !== '1,2') throw new Error(`self-test: found lines ${lines.join(',')}`);
  console.log('check-live-tests-use-test-workspaces self-test passed');
}

function run_check(baseline: ShrinkOnlyBaseline) {
  const lines_by_file = scan_live_test_files();
  const breaches = find_baseline_breaches(baseline, count_by_file(lines_by_file));
  if (breaches.length === 0) {
    const count = Object.keys(baseline).length;
    console.log(
      `check-live-tests-use-test-workspaces: no new workspace ids; ${count} files baselined`,
    );
    return;
  }
  console.error(
    'A live test or eval names a workspace id. A real workspace has real connected accounts and\n' +
      "colleagues' files, and a test that writes will change them. Create a throwaway workspace with\n" +
      'bootstrap_default_workspace(db) on the test database, and give every file, message and record\n' +
      'the test creates a unique nonsense name (`zq-livetest-${randomUUID()}`), never a real one:',
  );
  for (const { repository_path } of breaches) {
    for (const line of lines_by_file.get(repository_path) ?? []) {
      console.error(`  ${repository_path}:${line}`);
    }
  }
  process.exitCode = 1;
}

if (process.argv.includes('--self-test')) {
  run_self_test();
} else if (process.argv.includes('--create-baseline')) {
  create_first_baseline(baseline_path, count_by_file(scan_live_test_files()));
} else if (process.argv.includes('--update')) {
  const shrunk = shrink_baseline(
    read_baseline(baseline_path),
    count_by_file(scan_live_test_files()),
  );
  write_baseline(baseline_path, shrunk);
  console.log(
    `check-live-tests-use-test-workspaces: baseline now holds ${Object.keys(shrunk).length} files`,
  );
} else {
  run_check(read_baseline(baseline_path));
}
