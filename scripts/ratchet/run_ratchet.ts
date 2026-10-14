import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { baseline_relative_path, read_baseline, write_baseline } from '@scripts/ratchet/baseline_file';
import { count_by_rule_and_file, find_repository_root, run_rules_on_repository } from '@scripts/ratchet/collect_rule_results';
import { type CountChange, compare_to_baseline } from '@scripts/ratchet/compare_to_baseline';
import { print_growth, print_stale, print_totals } from '@scripts/ratchet/print_report';
import { ratchet_rules } from '@scripts/ratchet/rules/index';
import { run_self_test } from '@scripts/ratchet/self_test';

type RatchetMode = 'check' | 'update' | 'self_test';

const rule_ids = ratchet_rules.map((rule) => rule.rule_id);

function read_mode(argv: readonly string[]): RatchetMode {
  if (argv.includes('--self-test')) return 'self_test';
  return argv.includes('--update') ? 'update' : 'check';
}

function read_accepted_rule_ids(argv: readonly string[]): string[] {
  return argv.flatMap((argument, index) => (argument === '--accept-growth' ? [argv[index + 1] ?? ''] : []));
}

function measure_repository(repository_root: string) {
  const results = run_rules_on_repository(ratchet_rules, repository_root);
  const actual = count_by_rule_and_file(ratchet_rules, results);
  const baseline_path = join(repository_root, baseline_relative_path);
  return { results, actual, baseline_path, baseline: read_baseline(baseline_path) };
}

function run_check(repository_root: string): number {
  const started = performance.now();
  const { results, actual, baseline } = measure_repository(repository_root);
  if (!baseline) {
    console.error(`lint:ratchet FAIL: ${baseline_relative_path} is missing. Run \`bun run lint:ratchet:update\`.`);
    return 1;
  }
  const comparison = compare_to_baseline(baseline, actual, rule_ids);
  if (comparison.grown.length > 0) print_growth(ratchet_rules, comparison.grown, results);
  if (comparison.stale.length > 0 || comparison.unknown_rule_ids.length > 0) {
    print_stale(comparison.stale, comparison.unknown_rule_ids);
  }
  if (comparison.grown.length > 0 || comparison.stale.length > 0 || comparison.unknown_rule_ids.length > 0) return 1;
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`lint:ratchet PASS: ${ratchet_rules.length} rules, no file grew, baseline is current (${seconds}s).`);
  return 0;
}

function print_accepted_growth(accepted_growth: readonly CountChange[]): void {
  const added = accepted_growth.reduce((total, change) => total + change.actual - change.allowed, 0);
  const accepted_rule_ids = [...new Set(accepted_growth.map((change) => change.rule_id))].join(', ');
  console.warn('!'.repeat(78));
  console.warn(`WARNING: baseline GROWTH accepted for ${accepted_rule_ids}: +${added} in ${accepted_growth.length} file(s).`);
  console.warn('The ratchet now allows MORE of this pattern. Say why in the commit message.');
  for (const change of accepted_growth) {
    console.warn(`  ${change.file_path}  ${change.rule_id}  ${change.allowed} -> ${change.actual}`);
  }
  console.warn('!'.repeat(78));
}

function run_update(repository_root: string, accepted_rule_ids: readonly string[]): number {
  const unknown_rule_ids = accepted_rule_ids.filter((rule_id) => !rule_ids.includes(rule_id));
  if (unknown_rule_ids.length > 0) {
    console.error(`lint:ratchet:update: unknown rule id for --accept-growth: ${unknown_rule_ids.join(', ')}`);
    return 1;
  }
  const { results, actual, baseline, baseline_path } = measure_repository(repository_root);
  const comparison = compare_to_baseline(baseline ?? {}, actual, rule_ids);
  const growth = baseline ? comparison.grown : [];
  const new_rule_ids = rule_ids.filter((rule_id) => baseline && !(rule_id in baseline));
  if (new_rule_ids.length > 0) console.log(`lint:ratchet:update: seeding new rule(s): ${new_rule_ids.join(', ')}`);
  const refused = growth.filter((change) => ![...accepted_rule_ids, ...new_rule_ids].includes(change.rule_id));
  if (refused.length > 0) {
    print_growth(ratchet_rules, refused, results);
    console.error('lint:ratchet:update REFUSED: the baseline only shrinks. Fix the new violations,');
    console.error('or pass `--accept-growth <rule_id>` if the growth is deliberate.');
    return 1;
  }
  const accepted_growth = growth.filter((change) => !new_rule_ids.includes(change.rule_id));
  if (accepted_growth.length > 0) print_accepted_growth(accepted_growth);
  write_baseline(baseline_path, actual);
  const removed = comparison.stale.filter((change) => change.actual === 0).length;
  console.log(`lint:ratchet:update: ${baseline ? 'updated' : 'created'} ${baseline_relative_path}; ${removed} entries removed.`);
  print_totals(ratchet_rules, actual);
  return 0;
}

function run_self_test_mode(): number {
  const failures = run_self_test(ratchet_rules);
  for (const failure of failures) console.error(`lint:ratchet self-test FAIL: ${failure}`);
  if (failures.length === 0) console.log(`lint:ratchet self-test passed for ${ratchet_rules.length} rules.`);
  return failures.length === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
const mode = read_mode(argv);
if (mode === 'self_test') process.exitCode = run_self_test_mode();
if (mode === 'update') process.exitCode = run_update(find_repository_root(), read_accepted_rule_ids(argv));
if (mode === 'check') process.exitCode = run_check(find_repository_root());
