import { find_repository_root, run_rules_on_repository } from '@scripts/ratchet/collect_rule_results';
import { ratchet_rules } from '@scripts/ratchet/rules/index';

function find_rule(rule_id: string | undefined) {
  const rule = ratchet_rules.find((candidate) => candidate.rule_id === rule_id);
  if (rule) return rule;
  const known = ratchet_rules.map((candidate) => candidate.rule_id).join(', ');
  throw new Error(`unknown rule id "${rule_id ?? ''}". Known rules: ${known}`);
}

function list_violations(rule_id: string | undefined): void {
  const rule = find_rule(rule_id);
  const results = run_rules_on_repository([rule], find_repository_root());
  for (const result of results) {
    for (const violation of result.violations) console.log(`${result.file_path}:${violation.line}  ${violation.message}`);
  }
  const total = results.reduce((sum, result) => sum + result.count, 0);
  console.log(`${rule.rule_id}: ${total} in ${results.length} files`);
}

list_violations(process.argv[2]);
