import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { find_nodes, line_of_position, start_line_of } from '@scripts/ratchet/syntax_walk';

const line_limit = 50;

type FunctionWithBody =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.AccessorDeclaration;

function is_function_with_block_body(node: ts.Node): node is FunctionWithBody {
  if (ts.isArrowFunction(node)) return ts.isBlock(node.body);
  const is_function =
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isAccessor(node);
  return is_function && node.body !== undefined;
}

function read_function_name(node: FunctionWithBody): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const parent = node.parent;
  const is_named_parent = ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent);
  if (is_named_parent && ts.isIdentifier(parent.name)) return parent.name.text;
  return 'anonymous function';
}

function count_function_lines(node: FunctionWithBody, source_file: ts.SourceFile): number {
  return line_of_position(source_file, node.end) - start_line_of(node, source_file) + 1;
}

function find_violations({ source_file }: RatchetRuleInput) {
  return find_nodes(source_file, is_function_with_block_body).flatMap((node) => {
    const line_count = count_function_lines(node, source_file);
    if (line_count <= line_limit) return [];
    return [
      {
        line: start_line_of(node, source_file),
        message: `${read_function_name(node)} has ${line_count} lines (limit ${line_limit})`,
        weight: line_count - line_limit,
      },
    ];
  });
}

const body_lines = (count: number) => '  a();\n'.repeat(count);

export const max_function_lines_rule: RatchetRule = {
  rule_id: 'max-function-lines',
  summary:
    'Functions, methods, and block-body arrow functions in apps/** and packages/** stay at 50 lines or less. Weight is the lines over 50. Test files are exempt (describe and it callbacks are long by design).',
  why: 'A long function mixes several jobs. Agents extend it instead of splitting it, and it grows until nobody can read it.',
  how_to_fix:
    'Split the function into named stages (read_x, validate_x, build_x, save_x). The top function becomes a table of contents.',
  applies_to: is_source_file_outside_tests,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: `function long_one() {\n${body_lines(55)}}\nconst f = () => {\n${body_lines(49)}};\n`,
      expected_count: 8,
    },
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: `function short_one() {\n${body_lines(48)}}\nconst g = () =>\n  x(\n${'    1,\n'.repeat(60)}  );\n`,
      expected_count: 0,
    },
  ],
};
