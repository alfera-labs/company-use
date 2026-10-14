import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput, RatchetViolation } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const loose_method_names = new Set(['passthrough', 'loose']);

function read_zod_factory_name(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const { expression: receiver, name } = node.expression;
  return ts.isIdentifier(receiver) && receiver.text === 'z' ? name.text : undefined;
}

function list_chained_method_names(node: ts.Expression): string[] {
  const access = node.parent;
  if (!ts.isPropertyAccessExpression(access) || access.expression !== node) return [];
  const call = access.parent;
  if (!ts.isCallExpression(call) || call.expression !== access) return [];
  return [access.name.text, ...list_chained_method_names(call)];
}

function is_loose_method_call(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  return loose_method_names.has(node.expression.name.text) && node.arguments.length === 0;
}

function read_violation_message(node: ts.Node): string | undefined {
  if (is_loose_method_call(node)) return 'schema accepts unknown fields (`.passthrough()` / `.loose()`)';
  const factory_name = read_zod_factory_name(node);
  if (factory_name === 'looseObject') return '`z.looseObject` accepts unknown fields';
  if (factory_name !== 'object' || !ts.isCallExpression(node)) return undefined;
  const chain = list_chained_method_names(node);
  if (chain.includes('strict') || chain.some((name) => loose_method_names.has(name))) return undefined;
  return '`z.object` without `.strict()` drops unknown fields in silence';
}

function find_violations({ source_file, source_text }: RatchetRuleInput): RatchetViolation[] {
  if (!source_text.includes('z.') && !source_text.includes('.passthrough(') && !source_text.includes('.loose(')) return [];
  return find_nodes(source_file, (node) => read_violation_message(node) !== undefined).map((node) => ({
    line: start_line_of(node, source_file),
    message: read_violation_message(node) ?? '',
  }));
}

export const strict_boundary_schemas_rule: RatchetRule = {
  rule_id: 'strict-boundary-schemas',
  summary:
    'In apps/api/src/**, every `z.object(...)` chain calls `.strict()`, or the code uses `z.strictObject(...)`. `.passthrough()`, `.loose()`, and `z.looseObject(...)` count as violations. Test files are exempt.',
  why: 'A loose schema accepts fields the client must not set, such as `created_via`. The request passes, and the bad field reaches the service.',
  how_to_fix:
    'Use `z.strictObject({...})` or add `.strict()`, then return 422 for unknown fields. Flip one route at a time with a test, because old clients may send extra fields.',
  applies_to: (file_path) => is_source_file_outside_tests(file_path) && file_path.startsWith('apps/api/src/'),
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/routes/sample.ts',
      source_text:
        'const a = z.object({ b: z.string() });\nconst c = z.object({ d: z.object({ e: z.number() }) }).strict();\nconst f = z.looseObject({});\nconst g = z.object({}).passthrough();\nconst h = base_schema.loose();\n',
      expected_count: 5,
    },
    {
      file_path: 'apps/api/src/routes/sample.ts',
      source_text:
        'const a = z.object({ b: z.string() }).strict();\nconst c = z.strictObject({ d: z.string() });\nconst e = z.object({}).strict().optional();\nconst f = other.object({});\n',
      expected_count: 0,
    },
    { file_path: 'packages/core/src/sample.ts', source_text: 'const a = z.object({});\n', expected_count: 0 },
  ],
};
