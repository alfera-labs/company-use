import type { RatchetRule } from '@scripts/ratchet/rule_types';
import type { RuleCounts, RuleFileResult } from '@scripts/ratchet/collect_rule_results';
import { type CountChange, sum_counts } from '@scripts/ratchet/compare_to_baseline';

function print_rule_growth(rule: RatchetRule, changes: readonly CountChange[], results: readonly RuleFileResult[]): void {
  for (const change of changes) {
    const result = results.find((item) => item.rule_id === rule.rule_id && item.file_path === change.file_path);
    for (const violation of result?.violations ?? []) {
      console.error(`${change.file_path}:${violation.line}  ${rule.rule_id}  ${violation.message}`);
    }
    console.error(`  ${change.file_path}: ${change.actual} now, baseline allows ${change.allowed}`);
  }
  console.error(`  why: ${rule.why}`);
  console.error(`  how to fix: ${rule.how_to_fix}\n`);
}

export function print_growth(
  rules: readonly RatchetRule[],
  grown: readonly CountChange[],
  results: readonly RuleFileResult[],
): void {
  console.error(`lint:ratchet FAIL: ${grown.length} file(s) added violations of a ratcheted rule.\n`);
  for (const rule of rules) {
    const changes = grown.filter((change) => change.rule_id === rule.rule_id);
    if (changes.length > 0) print_rule_growth(rule, changes, results);
  }
}

export function print_stale(stale: readonly CountChange[], unknown_rule_ids: readonly string[]): void {
  console.error('lint:ratchet FAIL: the baseline allows more than the code has. A stale baseline lets the pattern grow back.');
  for (const change of stale) {
    console.error(`  ${change.file_path}  ${change.rule_id}  baseline ${change.allowed}, now ${change.actual}`);
  }
  for (const rule_id of unknown_rule_ids) console.error(`  ${rule_id}  is in the baseline but not in rules/index.ts`);
  console.error('Run `bun run lint:ratchet:update` and commit scripts/ratchet/baseline.json.\n');
}

export function print_totals(rules: readonly RatchetRule[], counts: RuleCounts): void {
  for (const rule of rules) {
    const file_counts = counts[rule.rule_id];
    console.log(`  ${rule.rule_id.padEnd(26)} ${String(sum_counts(file_counts)).padStart(7)} in ${Object.keys(file_counts ?? {}).length} files`);
  }
}
