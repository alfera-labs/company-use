import ts from 'typescript';
import { find_nodes } from '@scripts/ratchet/syntax_walk';

function is_method_call(node: ts.Node, method_name: string): node is ts.CallExpression & { expression: ts.PropertyAccessExpression } {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === method_name;
}

function is_update_set_values(node: ts.Node): node is ts.ObjectLiteralExpression {
  if (!ts.isObjectLiteralExpression(node)) return false;
  const call = node.parent;
  if (!is_method_call(call, 'set') || call.arguments[0] !== node) return false;
  return is_method_call(call.expression.expression, 'update');
}

export function list_update_set_values(source_file: ts.SourceFile): ts.ObjectLiteralExpression[] {
  if (!source_file.text.includes('.update(')) return [];
  return find_nodes(source_file, is_update_set_values);
}

export function read_property_name(property: ts.ObjectLiteralElementLike): string | undefined {
  const name = property.name;
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}
