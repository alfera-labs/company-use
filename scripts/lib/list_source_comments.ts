import * as ts from 'typescript';

export type SourceComment = {
  // 1-based line of the comment's first line.
  line: number;
  // One entry per source line the comment covers, markers included.
  lines: string[];
};

// Every comment in a TS/TSX file, found by the compiler's own scanner so that `//` inside a URL
// string or a JSX text node is never mistaken for a comment. Consecutive `//` lines are merged
// into one comment: a reader sees them as a single block, and so does the length rule.
export function list_source_comments(file_name: string, source: string): SourceComment[] {
  const kind = file_name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source_file = ts.createSourceFile(file_name, source, ts.ScriptTarget.Latest, false, kind);
  const ranges = new Map<number, ts.CommentRange>();
  const collect = (position: number) => {
    for (const range of ts.getLeadingCommentRanges(source, position) ?? []) {
      ranges.set(range.pos, range);
    }
    for (const range of ts.getTrailingCommentRanges(source, position) ?? []) {
      ranges.set(range.pos, range);
    }
  };
  const visit = (node: ts.Node) => {
    collect(node.getFullStart());
    collect(node.getEnd());
    for (const child of node.getChildren(source_file)) visit(child);
  };
  visit(source_file);

  const comments = [...ranges.values()]
    .sort((left, right) => left.pos - right.pos)
    .map((range) => ({
      line: source_file.getLineAndCharacterOfPosition(range.pos).line + 1,
      kind: range.kind,
      lines: source.slice(range.pos, range.end).split('\n'),
    }));
  return merge_adjacent_line_comments(comments);
}

function merge_adjacent_line_comments(
  comments: (SourceComment & { kind: ts.CommentKind })[],
): SourceComment[] {
  const merged: (SourceComment & { kind: ts.CommentKind })[] = [];
  for (const comment of comments) {
    const previous = merged.at(-1);
    const follows_previous =
      previous !== undefined &&
      previous.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
      comment.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
      previous.line + previous.lines.length === comment.line;
    if (follows_previous) previous.lines.push(...comment.lines);
    else merged.push({ ...comment, lines: [...comment.lines] });
  }
  return merged.map(({ line, lines }) => ({ line, lines }));
}
