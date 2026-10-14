import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

type Cast = ts.AsExpression | ts.TypeAssertion;

function is_cast(node: ts.Node): node is Cast {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function skip_parens_and_unknown_casts(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node)) return skip_parens_and_unknown_casts(node.expression);
  if (is_cast(node) && node.type.kind === ts.SyntaxKind.UnknownKeyword) return skip_parens_and_unknown_casts(node.expression);
  return node;
}

function is_json_parse_call(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const { expression: receiver, name } = node.expression;
  return ts.isIdentifier(receiver) && receiver.text === 'JSON' && name.text === 'parse';
}

function is_json_parse_cast(node: ts.Node): node is Cast {
  if (!is_cast(node) || node.type.kind === ts.SyntaxKind.UnknownKeyword) return false;
  return is_json_parse_call(skip_parens_and_unknown_casts(node.expression));
}

function find_violations({ source_file, source_text }: RatchetRuleInput) {
  if (!source_text.includes('JSON.parse')) return [];
  return find_nodes(source_file, is_json_parse_cast).map((node) => ({
    line: start_line_of(node, source_file),
    message: `\`JSON.parse(...)\` cast to \`${node.type.getText(source_file).replace(/\s+/gu, ' ')}\``,
  }));
}

export const no_json_parse_cast_rule: RatchetRule = {
  rule_id: 'no-json-parse-cast',
  summary:
    'No `JSON.parse(...) as T` or `<T>JSON.parse(...)` in apps/** and packages/**, test files included. `as unknown` alone is allowed.',
  why: 'A cast after `JSON.parse` tells the compiler a shape that nobody checked. Bad input then fails deep in the code, far from the parse.',
  how_to_fix: 'Parse with a schema: `schema.parse(JSON.parse(text))`. In a test, parse the response with the same schema the code uses.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/runtime-platform/src/sample.ts',
      source_text:
        'const a = JSON.parse(text) as Event;\nconst b = (JSON.parse(text)) as { id: string };\nconst c = <Event>JSON.parse(text);\nconst d = JSON.parse(text) as unknown as Event;\n',
      expected_count: 4,
    },
    {
      file_path: 'packages/runtime-platform/src/sample.ts',
      source_text:
        'const a = event_schema.parse(JSON.parse(text));\nconst b = JSON.parse(text) as unknown;\nconst c = other.parse(text) as Event;\n',
      expected_count: 0,
    },
  ],
};
