import ts from 'typescript';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

export type VitestMockCall = { readonly specifier: string; readonly line: number };

const mock_method_names = new Set(['mock', 'doMock']);

function read_literal_specifier(argument: ts.Expression | undefined): string | undefined {
  if (!argument) return undefined;
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (!ts.isCallExpression(argument) || argument.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  return read_literal_specifier(argument.arguments[0]);
}

function read_mock_specifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const { expression: receiver, name } = node.expression;
  if (!ts.isIdentifier(receiver) || receiver.text !== 'vi' || !mock_method_names.has(name.text)) return undefined;
  return read_literal_specifier(node.arguments[0]);
}

export function list_vitest_mock_calls(source_file: ts.SourceFile): VitestMockCall[] {
  if (!source_file.text.includes('vi.')) return [];
  return find_nodes(source_file, (node) => read_mock_specifier(node) !== undefined).map((node) => ({
    specifier: read_mock_specifier(node) ?? '',
    line: start_line_of(node, source_file),
  }));
}
