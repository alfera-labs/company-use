import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { list_update_set_values, read_property_name } from '@scripts/ratchet/rules/update_set_calls';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { start_line_of } from '@scripts/ratchet/syntax_walk';

const merge_helper_name = 'merge_metadata';

function skip_wrappers(node: ts.Expression): ts.Expression {
  const is_wrapper =
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node);
  return is_wrapper ? skip_wrappers(node.expression) : node;
}

function is_merge_value(node: ts.Expression): boolean {
  const value = skip_wrappers(node);
  if (ts.isTaggedTemplateExpression(value)) return ts.isIdentifier(value.tag) && value.tag.text === 'sql';
  if (ts.isCallExpression(value)) return ts.isIdentifier(value.expression) && value.expression.text === merge_helper_name;
  if (ts.isObjectLiteralExpression(value)) return value.properties.some(ts.isSpreadAssignment);
  if (ts.isConditionalExpression(value)) return is_merge_value(value.whenTrue) && is_merge_value(value.whenFalse);
  return ts.isIdentifier(value) && value.text === 'undefined';
}

function read_metadata_value(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (!/metadata$/u.test(read_property_name(property) ?? '')) return undefined;
  if (ts.isPropertyAssignment(property)) return property.initializer;
  return ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
}

function find_violations({ source_file }: RatchetRuleInput) {
  return list_update_set_values(source_file).flatMap((values) =>
    values.properties.flatMap((property) => {
      const value = read_metadata_value(property);
      if (!value || is_merge_value(value)) return [];
      return [{ line: start_line_of(property, source_file), message: `\`${read_property_name(property)}\` replaces the whole object` }];
    }),
  );
}

export const metadata_writes_merge_rule: RatchetRule = {
  rule_id: 'metadata-writes-merge',
  summary:
    'In `.update(table).set({...})`, a key that ends in `metadata` gets a `sql` template, a `merge_metadata(...)` call, or an object with a spread, in apps/** and packages/**. Any other value (an identifier, `input.metadata`, `x ?? {}`, a plain object) is a full replace. Test files are exempt.',
  why: 'A full replace deletes every key the writer did not know about. Other writers lose their data, and nobody sees an error.',
  how_to_fix:
    'Merge in SQL with a `sql` template: `column || patch::jsonb` or `jsonb_set(...)`. Or call `merge_metadata(column, patch)`.',
  applies_to: is_source_file_outside_tests,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/db/queries/sample.ts',
      source_text:
        'await db.update(t).set({ metadata: { a: 1 } });\nawait db.update(t).set({ run_metadata: input.metadata });\nawait db.update(t).set({ usage_metadata: x ?? {} });\nawait db.update(t).set({ metadata });\n',
      expected_count: 4,
    },
    {
      file_path: 'packages/core/src/db/queries/sample.ts',
      source_text:
        'await db.update(t).set({ metadata: sql`${t.metadata} || ${p}::jsonb` });\nawait db.update(t).set({ metadata: merge_metadata(t.metadata, p) });\nawait db.update(t).set({ metadata: { ...old.metadata, a: 1 } });\nawait db.update(t).set({ metadata: p ? sql`x` : undefined, name: n });\nawait db.insert(t).values({ metadata: m });\n',
      expected_count: 0,
    },
  ],
};
