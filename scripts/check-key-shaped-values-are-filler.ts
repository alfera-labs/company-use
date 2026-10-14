import { readFileSync } from 'node:fs';
import { list_repository_files } from '@scripts/lib/list_repository_files';
import * as ts from 'typescript';

/*
 * Guard: the test helpers in packages/shared/src/test_support/key_shaped_value.ts join a key
 * prefix and a body at run time, so a secret scanner never sees a whole key in the source.
 * That also hides a real key. So every body in the tree must be a string literal that is plain
 * sequential filler ("abcdef", "0123456789"). A private key block must be too short to be a key.
 */

const shortest_filler_run = 4;
const longest_private_key_filler = 40;
const helpers_file = 'packages/shared/src/test_support/key_shaped_value.ts';

const body_rules: Record<string, (body: string) => string | null> = {
  key_shaped_value: explain_body_that_is_not_filler,
  web_token_shaped_value: explain_body_that_is_not_filler,
  private_key_block: (body) =>
    body.length <= longest_private_key_filler
      ? null
      : `a private key body of ${body.length} characters is long enough to be a real key`,
};

type Finding = { repository_path: string; line: number; problem: string };

function follows(previous: string, next: string) {
  const [before, after] = [previous.toLowerCase(), next.toLowerCase()];
  if (/\d/u.test(before) && /\d/u.test(after)) return (Number(before) + 1) % 10 === Number(after);
  if (/[a-z]/u.test(before) && /[a-z]/u.test(after)) {
    return before.charCodeAt(0) + 1 === after.charCodeAt(0);
  }
  return false;
}

export function list_sequential_runs(part: string) {
  const runs: string[] = [];
  for (const character of part) {
    const run = runs.at(-1);
    if (run !== undefined && follows(run.at(-1) ?? '', character)) runs[runs.length - 1] += character;
    else runs.push(character);
  }
  return runs;
}

export function explain_body_that_is_not_filler(body: string) {
  const runs = body.split(/[-_.]/u).flatMap(list_sequential_runs);
  const broken = runs.find((run) => run.length < shortest_filler_run);
  return broken === undefined
    ? null
    : `"${broken}" is not a sequence like "abcdef" or "012345": the body looks random`;
}

export function find_bodies_that_are_not_filler(repository_path: string, source: string) {
  const source_file = ts.createSourceFile(repository_path, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const report = (node: ts.Node, problem: string) =>
    findings.push({
      repository_path,
      line: source_file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      problem,
    });
  const visit = (node: ts.Node) => {
    if (ts.isImportSpecifier(node) && node.propertyName && body_rules[node.propertyName.text]) {
      report(node, `import ${node.propertyName.text} under its own name, so this guard sees it`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const rule = body_rules[node.expression.text];
      const body = node.arguments[1];
      if (rule && body && !ts.isStringLiteralLike(body)) {
        report(node, 'the body must be a string literal, so this guard can read it');
      } else if (rule && body && ts.isStringLiteralLike(body)) {
        const problem = rule(body.text);
        if (problem) report(node, problem);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source_file);
  return findings;
}

function is_checked_file(repository_path: string) {
  return /\.(tsx?|mts|cts|mjs|js)$/u.test(repository_path) && repository_path !== helpers_file;
}

function run_self_test() {
  const filler = [
    "key_shaped_value('openai_project', 'abcdefghijklmnop1234567890QRSTUV')",
    "key_shaped_value('slack_bot', '123456789012-1234567890123-abcdefghijklmnopqrstuvwx')",
    "key_shaped_value('github_personal', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345')",
    "web_token_shaped_value({ sub: '1234567890' }, 'abcdefghijklmnop')",
    "private_key_block('RSA PRIVATE KEY', 'MIIBm2Fh+abc\\ndef==')",
  ];
  for (const source of filler) {
    const findings = find_bodies_that_are_not_filler('planted.test.ts', source);
    if (findings.length !== 0) throw new Error(`self-test: filler was refused: ${source}`);
  }
  const refused = [
    "key_shaped_value('github_personal', 'q7Zp2LkX9vTb4NwR8sHd3MfY6cJa1UeG5oBi')",
    "key_shaped_value('aws_access_key_id', 'IOSFODNN7EXAMPLE')",
    "key_shaped_value('stripe_live', 'abcdefgh' + suffix)",
    'key_shaped_value(shape, body_from_somewhere)',
    "web_token_shaped_value({}, 'dBjftJeZ4CVPmB92K27uhbUJU1p1r')",
    `private_key_block('RSA PRIVATE KEY', '${'MIIEvQIBADANBgkqhkiG9w0BAQEF'.repeat(2)}')`,
    "import { key_shaped_value as make } from '@coworker/shared/test_support/key_shaped_value';",
  ];
  for (const source of refused) {
    if (find_bodies_that_are_not_filler('planted.test.ts', source).length !== 1) {
      throw new Error(`self-test: a body that is not filler was accepted: ${source}`);
    }
  }
  console.log('check-key-shaped-values-are-filler self-test passed');
}

function run_check() {
  const findings = list_repository_files(is_checked_file).flatMap((repository_path) => {
    const source = readFileSync(repository_path, 'utf8');
    const names_a_helper = Object.keys(body_rules).some((helper) => source.includes(helper));
    return names_a_helper ? find_bodies_that_are_not_filler(repository_path, source) : [];
  });
  if (findings.length === 0) {
    console.log('check-key-shaped-values-are-filler: every key-shaped test value is filler');
    return;
  }
  console.error(
    'A key-shaped test value is not plain filler. These helpers hide a key from the secret\n' +
      'scan, so a real key must never pass through them. Use a sequence like "abcdefghij0123":',
  );
  for (const { repository_path, line, problem } of findings) {
    console.error(`  ${repository_path}:${line}: ${problem}`);
  }
  process.exitCode = 1;
}

if (process.argv.includes('--self-test')) run_self_test();
else run_check();
