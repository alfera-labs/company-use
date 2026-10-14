import ts from 'typescript';

export function find_nodes<T extends ts.Node>(root: ts.Node, is_match: (node: ts.Node) => node is T): T[];
export function find_nodes(root: ts.Node, is_match: (node: ts.Node) => boolean): ts.Node[];
export function find_nodes(root: ts.Node, is_match: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (is_match(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

export function line_of_position(source_file: ts.SourceFile, position: number): number {
  return source_file.getLineAndCharacterOfPosition(position).line + 1;
}

export function start_line_of(node: ts.Node, source_file: ts.SourceFile): number {
  return line_of_position(source_file, node.getStart(source_file));
}

export function parse_source_file(file_path: string, source_text: string): ts.SourceFile {
  const script_kind = file_path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const options = { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone };
  return ts.createSourceFile(file_path, source_text, options, true, script_kind);
}
