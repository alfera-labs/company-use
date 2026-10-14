import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { list_update_set_values, read_property_name } from '@scripts/ratchet/rules/update_set_calls';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { start_line_of } from '@scripts/ratchet/syntax_walk';

const lifecycle_keys = ['last_updated_time', 'last_updated_by'];

function find_violations({ source_file }: RatchetRuleInput) {
  return list_update_set_values(source_file).flatMap((values) => {
    if (values.properties.some(ts.isSpreadAssignment)) return [];
    const keys = values.properties.map(read_property_name);
    return lifecycle_keys
      .filter((key) => !keys.includes(key))
      .map((key) => ({ line: start_line_of(values, source_file), message: `\`.update().set({...})\` does not set ${key}` }));
  });
}

export const update_sets_lifecycle_columns_rule: RatchetRule = {
  rule_id: 'update-sets-lifecycle-columns',
  summary:
    'Every `.update(table).set({...})` object sets both `last_updated_time` and `last_updated_by`, or spreads a helper object, in apps/** and packages/**. Test files are exempt. Each missing key counts once.',
  why: 'An update without the lifecycle columns hides who changed a row and when. The audit trail then lies.',
  how_to_fix:
    'Set `last_updated_time` to `now()` and `last_updated_by` to the actor id in the same object. Or spread a helper that returns both.',
  applies_to: is_source_file_outside_tests,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/db/queries/sample.ts',
      source_text:
        "await db.update(runs).set({ run_status: 'done' });\nawait tx.update(t).set({ a: 1, last_updated_time: sql`now()` });\n",
      expected_count: 3,
    },
    {
      file_path: 'packages/core/src/db/queries/sample.ts',
      source_text:
        "await db.update(t).set({ a: 1, last_updated_time: now, 'last_updated_by': actor });\nawait db.update(t).set({ ...updated_by(actor), a: 1 });\nawait db.insert(t).values({ a: 1 });\nhash.update(x).digest();\n",
      expected_count: 0,
    },
  ],
};
