import { readFileSync } from 'node:fs';
import {
  create_sandbox_env,
  type SandboxEnv,
  sandbox_env_allowlist,
} from '@runtime-platform/orchestrator/sandbox_env';
import { list_repository_files } from '@scripts/lib/list_repository_files';
import * as ts from 'typescript';

/*
 * Guard: no credential enters the sandbox. Agent-written code runs there and can read its env
 * and command line; credentials reach vendors only through the egress proxy, outside it.
 * Rules: every `envs:` in runtime-platform comes from create_sandbox_env (or a builder that
 * calls it), which refuses keys missing from sandbox_env_allowlist; a credential-shaped allowlist
 * key needs a written `credential_exception`; no sandbox command, env builder or preview reads a
 * credential-shaped config value.
 */

const credential_name = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/iu;

// Calls whose arguments end up inside a sandbox: the command text, its env, a preview launch.
const sandbox_bound_calls = new Set([
  'commands.run',
  'create_sandbox_env',
  'start_preview',
  'start_e2b_background_command',
  'run_sandbox_command',
]);
// Env builders: each must call create_sandbox_env, so its result is allowlisted like a direct call.
const sandbox_env_builders = new Set([
  'create_e2b_command_env',
  'create_container_workspace_command_env',
]);
const allowlisted_env_sources = new Set(['create_sandbox_env', ...sandbox_env_builders]);

type Finding = { repository_path: string; line: number; problem: string };

export function is_sandbox_bound_file(repository_path: string) {
  return (
    /^(packages\/runtime-platform\/src|packages\/evals\/src\/browser|infra\/e2b)\/.+\.(ts|mts|mjs)$/u.test(
      repository_path,
    ) && !/(\.test\.|\/__tests__\/)/u.test(repository_path)
  );
}

function called_name(node: ts.CallExpression) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  // `sandbox.commands.run(...)` is named `commands.run`, so a database `.run()` never matches.
  const owner = callee.expression;
  const owner_name = ts.isPropertyAccessExpression(owner) ? owner.name.text : owner.getText();
  return owner_name === 'commands' ? `commands.${callee.name.text}` : callee.name.text;
}

// `env.OPENAI_API_KEY`, `process.env.GITHUB_TOKEN`, `process.env['X_SECRET']`.
function read_credential_config_name(node: ts.Node) {
  if (ts.isPropertyAccessExpression(node) && /(^|\.)env$/u.test(node.expression.getText())) {
    return credential_name.test(node.name.text) ? node.name.text : undefined;
  }
  if (
    ts.isElementAccessExpression(node) &&
    /(^|\.)env$/u.test(node.expression.getText()) &&
    ts.isStringLiteral(node.argumentExpression) &&
    credential_name.test(node.argumentExpression.text)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function find_credential_reads(root: ts.Node, report: (node: ts.Node, problem: string) => void) {
  const visit = (node: ts.Node) => {
    const name = read_credential_config_name(node);
    if (name) report(node, `reads ${name} into sandbox-bound code`);
    ts.forEachChild(node, visit);
  };
  visit(root);
}

function contains_call_to(root: ts.Node, name: string): boolean {
  if (ts.isCallExpression(root) && called_name(root) === name) return true;
  return ts.forEachChild(root, (child) => contains_call_to(child, name)) ?? false;
}

function find_envs_outside_allowlist(node: ts.Node) {
  if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'envs') return true;
  if (!ts.isPropertyAssignment(node) || node.name.getText() !== 'envs') return false;
  const value = node.initializer;
  return !(ts.isCallExpression(value) && allowlisted_env_sources.has(called_name(value) ?? ''));
}

export function find_sandbox_credential_leaks(repository_path: string, source: string): Finding[] {
  const source_file = ts.createSourceFile(repository_path, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const report = (node: ts.Node, problem: string) => {
    const line = source_file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    findings.push({ repository_path, line, problem });
  };
  const must_use_allowlist = repository_path.startsWith('packages/runtime-platform/');
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && sandbox_bound_calls.has(called_name(node) ?? '')) {
      for (const argument of node.arguments) find_credential_reads(argument, report);
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.body &&
      sandbox_env_builders.has(node.name?.text ?? '')
    ) {
      find_credential_reads(node.body, report);
      if (!contains_call_to(node.body, 'create_sandbox_env')) {
        report(node, `${node.name?.text} builds sandbox env without create_sandbox_env`);
      }
    }
    if (must_use_allowlist && find_envs_outside_allowlist(node)) {
      report(node, '`envs:` does not go through create_sandbox_env');
    }
    ts.forEachChild(node, visit);
  };
  visit(source_file);
  return findings;
}

export function find_unexplained_credential_keys(allowlist: Record<string, object>) {
  return Object.entries(allowlist)
    .filter(([key, rule]) => credential_name.test(key) && !('credential_exception' in rule))
    .map(([key]) => key);
}

function run_self_test() {
  const path = 'packages/runtime-platform/src/orchestrator/planted.ts';
  const planted: [string, string][] = [
    ['sandbox.commands.run(cmd, { envs: { OPENAI_API_KEY: "x" } });', 'does not go through'],
    ['sandbox.commands.run(cmd, { envs });', 'does not go through'],
    ['create_sandbox_env({ HOME: env.GITHUB_TOKEN });', 'reads GITHUB_TOKEN'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: planted source text
    ['sandbox.commands.run(`curl -H "x: ${process.env.STRIPE_SECRET}"`);', 'reads STRIPE_SECRET'],
    ["start_preview({ env: { A: process.env['DB_PASSWORD'] } });", 'reads DB_PASSWORD'],
    [
      'function create_e2b_command_env() { return create_sandbox_env({ A: env.COWORKER_API_KEY }); }',
      'reads COWORKER_API_KEY',
    ],
    [
      'function create_e2b_command_env() { return { HOME: "/tmp" }; }',
      'without create_sandbox_env',
    ],
  ];
  for (const [source, expected] of planted) {
    const problems = find_sandbox_credential_leaks(path, source).map((finding) => finding.problem);
    if (!problems.some((problem) => problem.includes(expected))) {
      throw new Error(`self-test: not caught (${expected}): ${source}`);
    }
  }
  const allowed = [
    'sandbox.commands.run(cmd, { envs: create_sandbox_env(create_e2b_command_env()) });',
    'await db.run({ api_key: env.OPENAI_API_KEY });',
    'Sandbox.create(env.COWORKER_E2B_TEMPLATE_ID, { apiKey: env.E2B_API_KEY });',
    'function create_e2b_command_env() { return create_sandbox_env({ LANG: process.env.LANG }); }',
    'sandbox.commands.run(cmd, { envs: create_e2b_command_env(input.env) });',
  ];
  for (const source of allowed) {
    const findings = find_sandbox_credential_leaks(path, source);
    if (findings.length > 0) throw new Error(`self-test: false positive: ${source}`);
  }
  const unexplained = find_unexplained_credential_keys({
    HOME: { purpose: 'home' },
    GITHUB_TOKEN: { purpose: 'clone repos' },
    ARCHIL_MOUNT_TOKEN: { purpose: 'mount', credential_exception: 'scoped to one disk' },
  });
  if (unexplained.join(',') !== 'GITHUB_TOKEN') {
    throw new Error(`self-test: unexplained credential keys were ${unexplained.join(',')}`);
  }
  // The by-construction half: a key missing from the allowlist is refused at runtime too.
  const refused = (() => {
    try {
      create_sandbox_env({ OPENAI_API_KEY: 'planted' } as SandboxEnv);
      return false;
    } catch {
      return true;
    }
  })();
  if (!refused) throw new Error('self-test: create_sandbox_env accepted OPENAI_API_KEY');
  console.log('check-no-credentials-in-sandbox self-test passed');
}

function run_check() {
  const findings = list_repository_files(is_sandbox_bound_file).flatMap((repository_path) =>
    find_sandbox_credential_leaks(repository_path, readFileSync(repository_path, 'utf8')),
  );
  for (const key of find_unexplained_credential_keys(sandbox_env_allowlist)) {
    const allowlist_path = 'packages/runtime-platform/src/orchestrator/sandbox_env.ts';
    findings.push({
      repository_path: allowlist_path,
      line: 1,
      problem: `${key} lacks a credential_exception`,
    });
  }
  const exceptions = Object.entries(sandbox_env_allowlist).filter(([key]) =>
    credential_name.test(key),
  );
  console.log(
    `check-no-credentials-in-sandbox: ${exceptions.length} credential-shaped keys enter the sandbox by ` +
      `written exception: ${exceptions.map(([key]) => key).join(', ')}`,
  );
  if (findings.length === 0) {
    console.log('check-no-credentials-in-sandbox: no credential reaches sandbox env or commands');
    return;
  }
  console.error(
    'A credential could reach the sandbox, where agent-written code can read it. Do not put keys,\n' +
      'tokens or secrets in sandbox env or command text. Let the egress proxy attach the credential\n' +
      'on the way out (sandbox_credential_headers.ts). Route every `envs:` through create_sandbox_env.\n' +
      'Adding a credential to sandbox_env_allowlist is a maintainer decision, not a lint fix:',
  );
  for (const { repository_path, line, problem } of findings) {
    console.error(`  ${repository_path}:${line}: ${problem}`);
  }
  process.exitCode = 1;
}

if (process.argv.includes('--self-test')) run_self_test();
else run_check();
