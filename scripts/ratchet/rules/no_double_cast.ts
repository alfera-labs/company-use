import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

type Cast = ts.AsExpression | ts.TypeAssertion;

const unknown_cast_pattern = /\bas\s+unknown\b|<unknown>/u;

function is_cast(node: ts.Node): node is Cast {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function skip_parens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? skip_parens(node.expression) : node;
}

function is_double_cast(node: ts.Node): node is Cast {
  if (!is_cast(node)) return false;
  const inner = skip_parens(node.expression);
  return is_cast(inner) && inner.type.kind === ts.SyntaxKind.UnknownKeyword;
}

function find_violations({ source_file, source_text }: RatchetRuleInput) {
  if (!unknown_cast_pattern.test(source_text)) return [];
  return find_nodes(source_file, is_double_cast).map((node) => ({
    line: start_line_of(node, source_file),
    message: `double cast \`as unknown as ${node.type.getText(source_file).replace(/\s+/gu, ' ')}\``,
  }));
}

export const no_double_cast_rule: RatchetRule = {
  rule_id: 'no-double-cast',
  summary: 'No `x as unknown as T` (or `<T><unknown>x`) in apps/** and packages/**, test files included.',
  why: 'A double cast forces any value into any type. The compiler stops checking, and the wrong shape reaches production.',
  how_to_fix:
    'Parse the value with a Zod schema, or fix the source type so one plain assignment works. In a test, build a typed fixture.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: 'const a = x as unknown as Run;\nconst b = (x as unknown) as Run;\nconst c = <Run>(<unknown>x);\n',
      expected_count: 3,
    },
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: 'const a = x as unknown;\nconst b = x as Run;\nconst c = run_schema.parse(x as unknown);\n',
      expected_count: 0,
    },
  ],
};
