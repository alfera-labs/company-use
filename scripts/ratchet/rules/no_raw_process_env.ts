import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

function is_process_reference(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === 'process';
  return ts.isPropertyAccessExpression(node) && node.name.text === 'process';
}

function is_env_key(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'env';
  return ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'env';
}

function is_process_env_access(node: ts.Node): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  return is_env_key(node) && is_process_reference(node.expression);
}

function find_violations({ source_file }: RatchetRuleInput) {
  return find_nodes(source_file, is_process_env_access).map((node) => ({
    line: start_line_of(node, source_file),
    message: 'raw process.env access',
  }));
}

export const no_raw_process_env_rule: RatchetRule = {
  rule_id: 'no-raw-process-env',
  summary: 'No `process.env` access in apps/** and packages/** outside packages/config/**. Test files are exempt.',
  why: 'A raw env read skips validation. A missing or malformed value fails late, deep in a request, instead of at startup.',
  how_to_fix:
    'Add the variable to the typed schema in packages/config and import it from @coworker/config (or @coworker/config/public_env in the browser).',
  applies_to: (file_path) => is_source_file_outside_tests(file_path) && !file_path.startsWith('packages/config/'),
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/sample.ts',
      source_text: "const a = process.env.API_KEY;\nconst b = process.env['X'];\nconst c = process['env'];\n",
      expected_count: 3,
    },
    {
      file_path: 'apps/api/src/sample.ts',
      source_text: "import { env } from '@coworker/config';\nconst a = env.API_KEY;\nconst p = process.cwd();\n",
      expected_count: 0,
    },
    { file_path: 'packages/config/src/env.ts', source_text: 'const a = process.env.X;\n', expected_count: 0 },
    { file_path: 'apps/api/src/__tests__/a.test.ts', source_text: 'const a = process.env.X;\n', expected_count: 0 },
  ],
};
