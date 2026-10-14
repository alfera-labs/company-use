import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';

const line_limit = 200;

function count_file_lines(source_text: string): number {
  if (source_text === '') return 0;
  const line_count = source_text.split('\n').length;
  return source_text.endsWith('\n') ? line_count - 1 : line_count;
}

function find_violations({ source_text }: RatchetRuleInput) {
  const line_count = count_file_lines(source_text);
  if (line_count <= line_limit) return [];
  return [
    {
      line: line_limit + 1,
      message: `file has ${line_count} lines (limit ${line_limit})`,
      weight: line_count - line_limit,
    },
  ];
}

export const max_file_lines_rule: RatchetRule = {
  rule_id: 'max-file-lines',
  summary: 'Files in apps/** and packages/** stay at 200 lines or less. Weight is the lines over 200. Test files are exempt.',
  why: 'A long file owns several concepts. Agents append to it because it is already there, and it keeps growing.',
  how_to_fix:
    'Move each concept into its own focused file named for what it owns. Keep the old file as the coordinator, or delete it.',
  applies_to: is_source_file_outside_tests,
  find_violations,
  self_test_samples: [
    { file_path: 'packages/core/src/sample.ts', source_text: 'x;\n'.repeat(203), expected_count: 3 },
    { file_path: 'packages/core/src/sample.ts', source_text: 'x;\n'.repeat(200), expected_count: 0 },
  ],
};
