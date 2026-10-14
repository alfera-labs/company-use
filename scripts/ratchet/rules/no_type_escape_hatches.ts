import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput, RatchetViolation } from '@scripts/ratchet/rule_types';
import { list_source_comments } from '@scripts/ratchet/source_comments';
import { is_source_file } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const directive_pattern = /^@ts-(?:ignore|nocheck|expect-error)\b/u;

function is_any_keyword(node: ts.Node): node is ts.KeywordTypeNode {
  return node.kind === ts.SyntaxKind.AnyKeyword;
}

function find_any_types(source_file: ts.SourceFile): RatchetViolation[] {
  return find_nodes(source_file, is_any_keyword).map((node) => ({
    line: start_line_of(node, source_file),
    message: ts.isAsExpression(node.parent) ? '`as any` cast' : '`any` type',
  }));
}

function find_directives(source_file: ts.SourceFile): RatchetViolation[] {
  return list_source_comments(source_file)
    .filter((comment) => directive_pattern.test(comment.body))
    .map((comment) => ({ line: comment.line, message: `${comment.body.split(/\s/u)[0]} directive` }));
}

function find_violations({ source_file }: RatchetRuleInput) {
  return [...find_any_types(source_file), ...find_directives(source_file)];
}

export const no_type_escape_hatches_rule: RatchetRule = {
  rule_id: 'no-type-escape-hatches',
  summary: 'No `any`, `as any`, @ts-ignore, @ts-nocheck, or @ts-expect-error in apps/** and packages/**, test files included.',
  why: 'Each escape hatch turns off the type checker for a value. The next agent copies it, and bugs pass the build.',
  how_to_fix:
    'Write the real type. Use `unknown` and a schema parse (Zod) at a boundary. In a test, build a typed fixture instead of casting.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/sample.ts',
      source_text:
        'let a: any;\nconst b = a as any;\n// @ts-ignore\nconst c = 1;\n/* @ts-expect-error reason */\nconst d: Array<any> = [];\n',
      expected_count: 5,
    },
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: "const a: unknown = 1;\nconst company = 'any';\n// We avoid @ts-ignore here.\n",
      expected_count: 0,
    },
  ],
};
