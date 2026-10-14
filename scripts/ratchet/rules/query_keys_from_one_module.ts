import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const query_keys_module = 'apps/app/src/lib/api/query_keys.ts';

const query_client_methods_with_key_argument = new Set([
  'setQueryData',
  'getQueryData',
  'ensureQueryData',
  'fetchQuery',
  'prefetchQuery',
]);

function applies_to(file_path: string): boolean {
  return file_path.startsWith('apps/app/src/') && file_path !== query_keys_module && is_source_file(file_path);
}

function is_inline_query_key_property(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node) || !ts.isArrayLiteralExpression(node.initializer)) return false;
  return (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'queryKey';
}

function is_inline_query_key_argument(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const [first_argument] = node.arguments;
  if (!first_argument || !ts.isArrayLiteralExpression(first_argument)) return false;
  return query_client_methods_with_key_argument.has(node.expression.name.text);
}

function find_violations({ source_file, source_text }: RatchetRuleInput) {
  if (!source_text.includes('[')) return [];
  const is_inline_key = (node: ts.Node) => is_inline_query_key_property(node) || is_inline_query_key_argument(node);
  return find_nodes(source_file, is_inline_key).map((node) => ({
    line: start_line_of(node, source_file),
    message: `inline query key; use a factory from ${query_keys_module}`,
  }));
}

export const query_keys_from_one_module_rule: RatchetRule = {
  rule_id: 'query-keys-from-one-module',
  summary: `In apps/app/src/**, React Query keys come from ${query_keys_module}, never an inline array literal.`,
  why: 'Two spellings of one key split one cache in two. A role change refreshed only one members list for that reason.',
  how_to_fix: `Add or reuse a factory in ${query_keys_module} and call it: \`queryKey: query_keys.automations()\`.`,
  applies_to,
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/app/src/components/app/sample.tsx',
      source_text:
        "useQuery({ queryKey: ['automations'] });\nclient.setQueryData(['automation', id], row);\nclient.invalidateQueries({ queryKey: ['agents'] });\n",
      expected_count: 3,
    },
    {
      file_path: 'apps/app/src/components/app/sample.tsx',
      source_text:
        'useQuery({ queryKey: query_keys.automations() });\nclient.setQueryData(query_keys.automation(id), row);\nconst list = [1, 2];\n',
      expected_count: 0,
    },
  ],
};
