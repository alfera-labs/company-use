import type { RuleCounts } from '@scripts/ratchet/collect_rule_results';

export type CountChange = {
  readonly rule_id: string;
  readonly file_path: string;
  readonly allowed: number;
  readonly actual: number;
};

export type BaselineComparison = {
  readonly grown: readonly CountChange[];
  readonly stale: readonly CountChange[];
  readonly unknown_rule_ids: readonly string[];
};

function list_count_changes(rule_id: string, baseline: RuleCounts, actual: RuleCounts): CountChange[] {
  const allowed_counts = baseline[rule_id] ?? {};
  const actual_counts = actual[rule_id] ?? {};
  const file_paths = [...new Set([...Object.keys(allowed_counts), ...Object.keys(actual_counts)])].sort();
  return file_paths
    .map((file_path) => ({ rule_id, file_path, allowed: allowed_counts[file_path] ?? 0, actual: actual_counts[file_path] ?? 0 }))
    .filter((change) => change.allowed !== change.actual);
}

export function compare_to_baseline(baseline: RuleCounts, actual: RuleCounts, rule_ids: readonly string[]): BaselineComparison {
  const changes = rule_ids.flatMap((rule_id) => list_count_changes(rule_id, baseline, actual));
  return {
    grown: changes.filter((change) => change.actual > change.allowed),
    stale: changes.filter((change) => change.actual < change.allowed),
    unknown_rule_ids: Object.keys(baseline).filter((rule_id) => !rule_ids.includes(rule_id)),
  };
}

export function sum_counts(file_counts: Record<string, number> | undefined): number {
  return Object.values(file_counts ?? {}).reduce((total, count) => total + count, 0);
}
