import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const body_reader_path = 'apps/api/src/lib/validate.ts';

function is_raw_json_body_read(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const { expression: receiver, name } = node.expression;
  return name.text === 'json' && ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'req';
}

function find_violations({ source_file, source_text }: RatchetRuleInput) {
  if (!source_text.includes('.json(')) return [];
  return find_nodes(source_file, is_raw_json_body_read).map((node) => ({
    line: start_line_of(node, source_file),
    message: 'raw `c.req.json()` body read',
  }));
}

export const one_json_body_reader_rule: RatchetRule = {
  rule_id: 'one-json-body-reader',
  summary: `\`<name>.req.json()\` appears only in ${body_reader_path}, in apps/** and packages/**. Test files are exempt.`,
  why: 'Each hand-made body reader handles bad JSON its own way, and some return null in silence. One reader gives one 400 shape.',
  how_to_fix:
    'Use `validate_json(schema)` or `parse_json_body` from @api/lib/validate. A signed webhook reads `c.req.text()` for the signature, then parses with a schema.',
  applies_to: (file_path) => is_source_file_outside_tests(file_path) && file_path !== body_reader_path,
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/routes/sample.ts',
      source_text: 'const a = await c.req.json();\nconst b = await context.req.json().catch(() => null);\n',
      expected_count: 2,
    },
    {
      file_path: 'apps/api/src/routes/sample.ts',
      source_text: 'const a = await parse_json_body(c, schema);\nconst b = await c.req.text();\nreturn c.json({ ok: true });\n',
      expected_count: 0,
    },
    { file_path: body_reader_path, source_text: 'const body: unknown = await c.req.json();\n', expected_count: 0 },
  ],
};
