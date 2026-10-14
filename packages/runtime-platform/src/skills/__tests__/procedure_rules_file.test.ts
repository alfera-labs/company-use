import {
  parse_procedure_rules,
  procedure_rules_path,
  render_procedure_rules,
  upsert_procedure_rule,
} from '@runtime-platform/skills/procedure_rules_file';
import { describe, expect, it } from 'vitest';

describe('procedure rules file', () => {
  it('round-trips a rule with the customer quote intact', () => {
    const rendered = render_procedure_rules('weekly-ordering', [
      {
        rule_key: 'order_minimum_units.northwind',
        rule_value: '500',
        said_by_customer: 'northwind is 500 units',
      },
    ]);
    const parsed = parse_procedure_rules(rendered);

    expect(parsed.rules).toEqual([
      {
        rule_key: 'order_minimum_units.northwind',
        rule_value: '500',
        said_by_customer: 'northwind is 500 units',
      },
    ]);
    expect(parsed.unparseable_lines).toEqual([]);
  });

  it('keeps a narrowing exception beside the rule it narrows', () => {
    const base = upsert_procedure_rule([], {
      rule_key: 'order_minimum_units',
      rule_value: '100',
    });
    const both = upsert_procedure_rule(base.rules, {
      rule_key: 'order_minimum_units.northwind',
      rule_value: '500',
    });

    expect(both.rules.map((rule) => rule.rule_key)).toEqual([
      'order_minimum_units',
      'order_minimum_units.northwind',
    ]);
  });

  it('replaces a corrected rule in place instead of appending a second answer', () => {
    const first = upsert_procedure_rule([], { rule_key: 'discount', rule_value: '30%' });
    const corrected = upsert_procedure_rule(first.rules, {
      rule_key: 'discount',
      rule_value: '15%',
    });

    expect(corrected.outcome).toBe('replaced');
    expect(corrected.rules).toEqual([{ rule_key: 'discount', rule_value: '15%' }]);
  });

  it('reports an unchanged rule so the caller does not rewrite the file for nothing', () => {
    const first = upsert_procedure_rule([], { rule_key: 'seasonality', rule_value: 'off' });
    const again = upsert_procedure_rule(first.rules, {
      rule_key: 'seasonality',
      rule_value: 'off',
    });

    expect(again.outcome).toBe('unchanged');
  });

  it('preserves and flags a hand-edited line it cannot read as a rule', () => {
    const parsed = parse_procedure_rules('discount: 15%\nplease also never ship on mondays\n');

    expect(parsed.rules).toEqual([{ rule_key: 'discount', rule_value: '15%' }]);
    expect(parsed.unparseable_lines).toEqual(['please also never ship on mondays']);

    const rendered = render_procedure_rules('p', parsed.rules, parsed.unparseable_lines);
    expect(rendered).toContain('please also never ship on mondays');
    expect(rendered).toContain('doing nothing');
  });

  it('ignores comments and blank lines without calling them unparseable', () => {
    const parsed = parse_procedure_rules('# a comment\n\ndiscount: 15%\n');
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.unparseable_lines).toEqual([]);
  });

  it('lives in the procedures folder every workspace is seeded with', () => {
    expect(procedure_rules_path('weekly-ordering')).toBe('skills/weekly-ordering/rules.md');
  });
});
