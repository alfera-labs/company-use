import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RatchetRule, RatchetViolation } from '@scripts/ratchet/rule_types';
import { parse_source_file } from '@scripts/ratchet/syntax_walk';

export type RuleFileResult = {
  readonly rule_id: string;
  readonly file_path: string;
  readonly violations: readonly RatchetViolation[];
  readonly count: number;
};

export type RuleCounts = Record<string, Record<string, number>>;

export function find_repository_root(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

export function list_source_files(repository_root: string): string[] {
  const git_arguments = ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.ts', '*.tsx', '*.mts', '*.cts'];
  const output = execFileSync('git', git_arguments, { cwd: repository_root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const file_paths = new Set(output.split('\0').filter(Boolean));
  return [...file_paths].filter((file_path) => existsSync(join(repository_root, file_path))).sort();
}

export function sum_violation_weights(violations: readonly RatchetViolation[]): number {
  return violations.reduce((total, violation) => total + (violation.weight ?? 1), 0);
}

export function run_rules_on_source(rules: readonly RatchetRule[], file_path: string, source_text: string): RuleFileResult[] {
  const matching_rules = rules.filter((rule) => rule.applies_to(file_path));
  if (matching_rules.length === 0) return [];
  const source_file = parse_source_file(file_path, source_text);
  return matching_rules.flatMap((rule) => {
    const violations = rule.find_violations({ file_path, source_text, source_file });
    const count = sum_violation_weights(violations);
    return count > 0 ? [{ rule_id: rule.rule_id, file_path, violations, count }] : [];
  });
}

export function run_rules_on_repository(rules: readonly RatchetRule[], repository_root: string): RuleFileResult[] {
  return list_source_files(repository_root).flatMap((file_path) => {
    if (!rules.some((rule) => rule.applies_to(file_path))) return [];
    const source_text = readFileSync(join(repository_root, file_path), 'utf8');
    return run_rules_on_source(rules, file_path, source_text);
  });
}

export function count_by_rule_and_file(rules: readonly RatchetRule[], results: readonly RuleFileResult[]): RuleCounts {
  const counts: RuleCounts = Object.fromEntries(rules.map((rule) => [rule.rule_id, {}]));
  for (const result of results) {
    const rule_counts = counts[result.rule_id] ?? {};
    rule_counts[result.file_path] = result.count;
    counts[result.rule_id] = rule_counts;
  }
  return counts;
}
