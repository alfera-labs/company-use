import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { RuleCounts } from '@scripts/ratchet/collect_rule_results';

export const baseline_relative_path = 'scripts/ratchet/baseline.json';

const baseline_schema = z
  .object({
    version: z.literal(1),
    rules: z.record(z.string(), z.record(z.string(), z.number().int().positive())),
  })
  .strict();

export function read_baseline(baseline_path: string): RuleCounts | undefined {
  if (!existsSync(baseline_path)) return undefined;
  return baseline_schema.parse(JSON.parse(readFileSync(baseline_path, 'utf8'))).rules;
}

function sort_object_keys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => (left < right ? -1 : 1)));
}

export function write_baseline(baseline_path: string, counts: RuleCounts): void {
  const sorted_rules = Object.fromEntries(
    Object.entries(sort_object_keys(counts)).map(([rule_id, file_counts]) => [rule_id, sort_object_keys(file_counts)]),
  );
  writeFileSync(baseline_path, `${JSON.stringify({ version: 1, rules: sorted_rules }, null, 2)}\n`);
}
