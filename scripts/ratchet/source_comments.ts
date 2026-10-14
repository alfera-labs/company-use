import ts from 'typescript';
import { line_of_position } from '@scripts/ratchet/syntax_walk';

export type SourceComment = {
  readonly position: number;
  readonly end: number;
  readonly text: string;
  readonly body: string;
  readonly line: number;
  readonly line_count: number;
};

const comments_by_source_file = new WeakMap<ts.SourceFile, readonly SourceComment[]>();

export function list_source_comments(source_file: ts.SourceFile): readonly SourceComment[] {
  const cached = comments_by_source_file.get(source_file);
  if (cached) return cached;
  const comments = collect_comment_ranges(source_file).map((range) => to_source_comment(source_file, range));
  comments_by_source_file.set(source_file, comments);
  return comments;
}

export function read_comment_body(comment_text: string): string {
  const without_markers = comment_text.replace(/^\/\/+|^\/\*+|\*+\/$/gu, '');
  return without_markers
    .split('\n')
    .map((line) => line.replace(/^\s*\*+/u, '').trim())
    .filter(Boolean)
    .join('\n');
}

function collect_comment_ranges(source_file: ts.SourceFile): ts.CommentRange[] {
  const text = source_file.text;
  const ranges = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(source_file);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    if (node.kind === ts.SyntaxKind.JsxText) return;
    const leading = ts.getLeadingCommentRanges(text, node.pos) ?? [];
    const trailing = ts.getTrailingCommentRanges(text, node.pos) ?? [];
    for (const range of [...leading, ...trailing]) ranges.set(range.pos, range);
  };
  visit(source_file);
  return [...ranges.values()].sort((left, right) => left.pos - right.pos);
}

function to_source_comment(source_file: ts.SourceFile, range: ts.CommentRange): SourceComment {
  const text = source_file.text.slice(range.pos, range.end);
  const line = line_of_position(source_file, range.pos);
  const last_line = line_of_position(source_file, range.end);
  return { position: range.pos, end: range.end, text, body: read_comment_body(text), line, line_count: last_line - line + 1 };
}
