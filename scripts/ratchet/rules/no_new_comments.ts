import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { list_source_comments, type SourceComment } from '@scripts/ratchet/source_comments';
import { is_source_file } from '@scripts/ratchet/source_scope';

export const tool_directive_pattern =
  /^(?:biome-ignore|@ts-expect-error|@ts-ignore|@ts-nocheck|eslint-disable|eslint-enable|<reference\s|[#@]__PURE__|[#@]__NO_SIDE_EFFECTS__|webpackChunkName|@vite-ignore|prettier-ignore|@vitest-environment|@jsxImportSource|(?:istanbul|c8|v8) ignore)/u;
export const license_pattern = /licen[sc]e|copyright|SPDX-License-Identifier/iu;
const url_only_pattern = /^https?:\/\/\S+$/u;

function is_exported_statement(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement)) return true;
  if (!ts.canHaveModifiers(statement)) return false;
  return ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function find_exported_doc_positions(source_file: ts.SourceFile): Set<number> {
  const positions = new Set<number>();
  const text = source_file.text;
  for (const statement of source_file.statements) {
    if (!is_exported_statement(statement)) continue;
    const doc = (ts.getLeadingCommentRanges(text, statement.pos) ?? []).at(-1);
    if (!doc || !text.startsWith('/**', doc.pos)) continue;
    if (text.slice(doc.end, statement.getStart(source_file)).trim() === '') positions.add(doc.pos);
  }
  return positions;
}

function is_license_header(comment: SourceComment, source_text: string): boolean {
  const before = source_text.slice(0, comment.position).replace(/^#!.*/u, '').trim();
  return before === '' && license_pattern.test(comment.body);
}

function is_allowed_comment(comment: SourceComment, source_text: string, doc_positions: Set<number>): boolean {
  if (tool_directive_pattern.test(comment.body) || url_only_pattern.test(comment.body)) return true;
  return doc_positions.has(comment.position) || is_license_header(comment, source_text);
}

function find_violations({ source_file, source_text }: RatchetRuleInput) {
  const doc_positions = find_exported_doc_positions(source_file);
  return list_source_comments(source_file)
    .filter((comment) => !is_allowed_comment(comment, source_text, doc_positions))
    .map((comment) => ({
      line: comment.line,
      message: `comment: ${comment.body.split('\n')[0]?.slice(0, 70) ?? ''}`,
      weight: comment.line_count,
    }));
}

const tricky_clean_sample = [
  '/* Copyright 2026 Alfera. MIT License. */',
  '// biome-ignore lint/style/noNonNullAssertion: the key is always set',
  'const url = `https://a.b/${1}//c`;',
  "const pattern = /\\/\\/x/u; const text = '// not a comment';",
  '// https://github.com/acme/widgets/issues/1',
  '/** Doc for an exported function. */',
  'export function f() { return pattern.test(url + text); }',
].join('\n');

export const no_new_comments_rule: RatchetRule = {
  rule_id: 'no-new-comments',
  summary: 'No code comments in apps/** and packages/**, test files included. Weight is the number of comment lines.',
  why: 'Comments drift from the code and agents copy them. A good name explains the code; a comment only repeats or contradicts it.',
  how_to_fix:
    'Delete the comment. Move its meaning into a function or variable name. Allowed: tool directives, a license header, a JSDoc block on an exported declaration, a comment that is only a URL.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/sample.ts',
      source_text: 'const a = 1; // counts\n/* two\n lines */\nexport const b = 2;\n/** not exported */\nfunction g() {}\n',
      expected_count: 4,
    },
    { file_path: 'apps/api/src/sample.ts', source_text: tricky_clean_sample, expected_count: 0 },
    { file_path: 'apps/app/src/sample.tsx', source_text: 'export const v = <p>// text {x} /* also text */</p>;\n', expected_count: 0 },
    { file_path: 'apps/app/src/sample.tsx', source_text: 'export const v = <p>{/* a comment */}</p>;\n', expected_count: 1 },
    { file_path: 'apps/app/src/routeTree.gen.ts', source_text: '// generated\n', expected_count: 0 },
  ],
};
