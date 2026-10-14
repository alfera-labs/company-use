import type { RatchetRule, RatchetRuleInput, RatchetViolation } from '@scripts/ratchet/rule_types';
import { list_source_comments, type SourceComment } from '@scripts/ratchet/source_comments';
import { is_source_file } from '@scripts/ratchet/source_scope';

const marker_patterns = [
  /\b(?:TODO|FIXME|HACK|XXX)\b/gu,
  /\b(?:work[- ]?around|for now|temporary|band-?aid|kludge)\b/giu,
];

function find_markers_in_comment(comment: SourceComment): RatchetViolation[] {
  return marker_patterns.flatMap((pattern) =>
    [...comment.text.matchAll(pattern)].map((match) => ({
      line: comment.line + (comment.text.slice(0, match.index).match(/\n/gu)?.length ?? 0),
      message: `workaround marker "${match[0]}"`,
    })),
  );
}

function find_violations({ source_file }: RatchetRuleInput) {
  return list_source_comments(source_file).flatMap(find_markers_in_comment);
}

export const no_workaround_markers_rule: RatchetRule = {
  rule_id: 'no-workaround-markers',
  summary:
    'No TODO, FIXME, HACK, XXX, "workaround", "for now", "temporary", "band-aid", or "kludge" in comments in apps/** and packages/**, test files included.',
  why: 'A marker records a known defect and then stays for years. Agents read it as permission to add another shortcut.',
  how_to_fix: 'Fix the defect now, or open an issue and delete the marker. Do not move the marker to another line.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: '// TODO: fix\n/* a workaround\n for now */\nconst x = 1;\n',
      expected_count: 3,
    },
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: "const todo_list = 'TODO for now';\n// Store the draft in a folder.\n",
      expected_count: 0,
    },
  ],
};
