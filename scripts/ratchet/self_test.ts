import type { RatchetRule } from '@scripts/ratchet/rule_types';
import { run_rules_on_source, sum_violation_weights } from '@scripts/ratchet/collect_rule_results';
import { compare_to_baseline } from '@scripts/ratchet/compare_to_baseline';
import { find_import_direction_cycle, is_import_direction_allowed } from '@scripts/ratchet/rules/import-direction-graph';
import { import_units } from '@scripts/ratchet/rules/import-direction-table';

function test_rule_samples(rule: RatchetRule): string[] {
  const samples = rule.self_test_samples ?? [];
  const has_both_kinds = samples.some((sample) => sample.expected_count > 0) && samples.some((sample) => sample.expected_count === 0);
  if (!has_both_kinds) return [`${rule.rule_id}: add self_test_samples with one violating and one clean sample`];
  return samples.flatMap((sample, index) => {
    const results = run_rules_on_source([rule], sample.file_path, sample.source_text);
    const violations = results.flatMap((result) => result.violations);
    const actual = sum_violation_weights(violations);
    if (actual === sample.expected_count) return [];
    const found = violations.map((violation) => `line ${violation.line}: ${violation.message}`).join('; ');
    return [`${rule.rule_id} sample ${index}: expected ${sample.expected_count}, found ${actual} [${found}]`];
  });
}

function test_registry(rules: readonly RatchetRule[]): string[] {
  const rule_ids = rules.map((rule) => rule.rule_id);
  const duplicates = rule_ids.filter((rule_id, index) => rule_ids.indexOf(rule_id) !== index);
  return duplicates.map((rule_id) => `${rule_id}: registered twice in rules/index.ts`);
}

function test_comparison(): string[] {
  const baseline = { a: { 'x.ts': 2, 'y.ts': 1 }, gone: { 'z.ts': 1 } };
  const actual = { a: { 'x.ts': 3, 'new.ts': 1 } };
  const comparison = compare_to_baseline(baseline, actual, ['a']);
  const grown = comparison.grown.map((change) => change.file_path).join(',');
  const stale = comparison.stale.map((change) => change.file_path).join(',');
  const failures: string[] = [];
  if (grown !== 'new.ts,x.ts') failures.push(`comparison: expected grown new.ts,x.ts, found ${grown}`);
  if (stale !== 'y.ts') failures.push(`comparison: expected stale y.ts, found ${stale}`);
  if (comparison.unknown_rule_ids.join(',') !== 'gone') failures.push('comparison: a removed rule was not reported');
  return failures;
}

function test_import_direction_graph(): string[] {
  const failures: string[] = [];
  const real_cycle = find_import_direction_cycle(import_units);
  if (real_cycle) failures.push(`import-direction-table.ts has a cycle: ${real_cycle.join(' -> ')}`);
  const cyclic_units = {
    'packages/x': { may_import: ['packages/y'], may_import_types_only: [], test_may_import: [], ships_to_browser: 'never' as const },
    'packages/y': { may_import: ['packages/x'], may_import_types_only: [], test_may_import: [], ships_to_browser: 'never' as const },
  };
  if (!find_import_direction_cycle(cyclic_units)) failures.push('find_import_direction_cycle missed a two-unit cycle fixture');
  const seeding_units = {
    'packages/a': { may_import: [], may_import_types_only: [], test_may_import: ['packages/b'], ships_to_browser: 'never' as const },
    'packages/b': { may_import: [], may_import_types_only: [], test_may_import: [], ships_to_browser: 'never' as const },
  };
  const check = { type_only: false };
  if (!is_import_direction_allowed(seeding_units, 'packages/a', 'packages/b', { ...check, is_test_file: true })) {
    failures.push('is_import_direction_allowed rejected a test file import listed in test_may_import');
  }
  if (is_import_direction_allowed(seeding_units, 'packages/a', 'packages/b', { ...check, is_test_file: false })) {
    failures.push('is_import_direction_allowed let a production file import a test_may_import-only unit');
  }
  return failures;
}

export function run_self_test(rules: readonly RatchetRule[]): string[] {
  return [...test_registry(rules), ...test_comparison(), ...test_import_direction_graph(), ...rules.flatMap(test_rule_samples)];
}
