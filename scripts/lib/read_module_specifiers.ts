import * as ts from 'typescript';

export type SourceFileForScan = { file_path: string; source_text: string };
export type ModuleSpecifierNode = { specifier_text: string; range: { start: number; end: number } };

export function read_module_specifiers(file: SourceFileForScan): string[] {
  return find_module_specifier_nodes(file).map((node) => node.specifier_text);
}

export function find_module_specifier_nodes(file: SourceFileForScan): ModuleSpecifierNode[] {
  const { file_path, source_text } = file;
  const source_file = ts.createSourceFile(file_path, source_text, ts.ScriptTarget.Latest, true);
  const nodes: ModuleSpecifierNode[] = [];
  const visit = (node: ts.Node) => {
    const literal = read_module_specifier_literal(node);
    if (literal !== null) {
      nodes.push({ specifier_text: literal.text, range: { start: literal.getStart(), end: literal.getEnd() } });
    }
    ts.forEachChild(node, visit);
  };
  visit(source_file);
  return nodes;
}

function read_module_specifier_literal(node: ts.Node): ts.StringLiteralLike | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    return specifier && ts.isStringLiteral(specifier) ? specifier : null;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    const { literal } = node.argument;
    return ts.isStringLiteral(literal) ? literal : null;
  }
  if (ts.isCallExpression(node) && is_module_loading_call(node)) {
    const [argument] = node.arguments;
    return argument && ts.isStringLiteralLike(argument) ? argument : null;
  }
  return null;
}

function is_module_loading_call(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(node.expression)) return node.expression.text === 'require';
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'vi' &&
    ['mock', 'doMock', 'importActual'].includes(node.expression.name.text)
  );
}
