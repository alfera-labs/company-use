import { procedures_folder } from '@runtime-platform/storage/workspace_layouts';

export type ProcedureRule = {
  rule_key: string;
  rule_value: string;
  said_by_customer?: string | undefined;
};

export type ParsedProcedureRules = {
  rules: ProcedureRule[];
  unparseable_lines: string[];
};

const rule_line_pattern = /^([A-Za-z0-9_.-]+)\s*:\s*([^#]*[^#\s])\s*(?:#\s*"?(.*?)"?\s*)?$/;

/** Every rule already recorded, in file order, plus the lines that could not be read as rules. */
export function parse_procedure_rules(file_contents: string | undefined): ParsedProcedureRules {
  if (!file_contents) return { rules: [], unparseable_lines: [] };

  const rules: ProcedureRule[] = [];
  const unparseable_lines: string[] = [];
  for (const line of file_contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = rule_line_pattern.exec(trimmed);
    const [, rule_key, rule_value, said_by_customer] = match ?? [];
    if (!rule_key || !rule_value) {
      unparseable_lines.push(trimmed);
      continue;
    }

    rules.push({
      rule_key,
      rule_value: rule_value.trim(),
      ...(said_by_customer ? { said_by_customer } : {}),
    });
  }
  return { rules, unparseable_lines };
}

export type RuleUpsert = { rules: ProcedureRule[]; outcome: 'added' | 'replaced' | 'unchanged' };

/**
 * Put one rule in the list. A key that is already present is REPLACED in place — appending a
 * second line for the same key is how a file ends up with two answers and the reader picks the
 * wrong one. The customer corrected the rule; they did not add a rule.
 */
export function upsert_procedure_rule(rules: ProcedureRule[], rule: ProcedureRule): RuleUpsert {
  const existing_index = rules.findIndex((candidate) => candidate.rule_key === rule.rule_key);
  if (existing_index === -1) return { rules: [...rules, rule], outcome: 'added' };

  const existing = rules[existing_index];
  if (existing?.rule_value === rule.rule_value) return { rules, outcome: 'unchanged' };

  const replaced = [...rules];
  replaced[existing_index] = rule;
  return { rules: replaced, outcome: 'replaced' };
}

/**
 * The file as it should be written: a header nobody has to be taught, one line per rule in key
 * order (a dotted narrowing therefore sorts under the rule it narrows), and any hand-written
 * lines that could not be parsed, kept verbatim under a marker instead of being destroyed.
 */
export function render_procedure_rules(
  procedure_slug: string,
  rules: ProcedureRule[],
  unparseable_lines: string[] = [],
): string {
  const header = [
    `# Rules for ${procedure_slug}. One line per rule, in the customer's own words.`,
    '# Edit a line to change a rule; never add a second line for the same key.',
    '# A dotted key narrows the rule above it: target_stock_months.france narrows target_stock_months.',
    '',
  ];
  const lines = [...rules]
    .sort((left, right) => left.rule_key.localeCompare(right.rule_key))
    .map((rule) =>
      rule.said_by_customer
        ? `${rule.rule_key}: ${rule.rule_value}  # "${rule.said_by_customer}"`
        : `${rule.rule_key}: ${rule.rule_value}`,
    );
  const kept = unparseable_lines.length
    ? [
        '',
        '# These lines could not be read as rules and are doing nothing. Fix or remove them:',
        ...unparseable_lines,
      ]
    : [];

  return [...header, ...lines, ...kept, ''].join('\n');
}

/** Where a procedure's rules live: inside its folder in the workspace's procedures folder. */
export function procedure_rules_path(procedure_slug: string): string {
  return `${procedures_folder}/${procedure_slug}/rules.md`;
}
