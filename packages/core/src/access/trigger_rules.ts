import { trigger_rule_operations } from '@coworker/core/db/schema/automation_contracts';
import type { TriggerRule, TriggerRuleOperation } from '@coworker/core/db/schema/json_column_types';
import { z } from 'zod';

export { trigger_rule_operations };

export const trigger_rule_schema = z.strictObject({
  field: z.string().min(1),
  operation: z.enum(trigger_rule_operations),
  values: z.array(z.string()).optional(),
});

export type TriggerRulesVerdict =
  | { passed: true }
  | { passed: false; rule: TriggerRule; reason: string };

type RuleOperation = (input: {
  values: string[];
  field_values: string[];
  data: Record<string, unknown>;
  field: string;
}) => boolean;

const rule_operations: Record<TriggerRuleOperation, RuleOperation> = {
  equals_any_of: ({ values, field_values }) =>
    field_values.some((field_value) => values.includes(field_value)),
  is_not_any_of: ({ values, field_values }) =>
    !field_values.some((field_value) => values.includes(field_value)),
  contains_any_of: ({ values, field_values }) =>
    field_values.some((field_value) => values.some((value) => field_value.includes(value))),
  does_not_contain_any_of: ({ values, field_values }) =>
    !field_values.some((field_value) => values.some((value) => field_value.includes(value))),
  is_present: ({ field_values }) => field_values.length > 0,
  is_absent: ({ field_values }) => field_values.length === 0,
  address_is_any_of: ({ values, field_values }) =>
    field_values.some((field_value) =>
      values.map(read_address).includes(read_address(field_value)),
    ),
  address_is_not_any_of: (input) => !rule_operations.address_is_any_of(input),
  header_present: ({ values, data, field }) => {
    const names = read_header_names(data, field);
    return values.some((value) => names.has(value));
  },
  header_missing: (input) => !rule_operations.header_present(input),
};

// The header names an event carries, from either shape a provider sends: Gmail's
// `payload.headers` list of {name, value} objects, or a flat map of header name to value.
function read_header_names(data: Record<string, unknown>, field: string): Set<string> {
  const source =
    read_dot_path(data, field) ??
    read_dot_path(data, 'payload.headers') ??
    read_dot_path(data, 'headers');
  const names = Array.isArray(source)
    ? source.map((item) => (is_plain_object(item) ? stringify_field_value(item.name ?? '') : ''))
    : is_plain_object(source)
      ? Object.keys(source)
      : [];
  return new Set(names.map(normalize_for_compare).filter((name) => name.length > 0));
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function read_address(value: string): string {
  return normalize_for_compare(value.match(/<([^>]+)>/)?.[1] ?? value);
}

export function apply_trigger_rules(
  rules: TriggerRule[],
  data: Record<string, unknown>,
): TriggerRulesVerdict {
  for (const rule of rules) {
    const field_values = read_field_values(data, rule.field);
    const values = (rule.values ?? []).map(normalize_for_compare);
    const passed = rule_operations[rule.operation]({
      values,
      field_values,
      data,
      field: rule.field,
    });
    if (!passed) return { passed: false, rule, reason: explain_failed_rule(rule, field_values) };
  }
  return { passed: true };
}

const shown_values_limit = 3;
const shown_value_length = 60;

function explain_failed_rule(rule: TriggerRule, field_values: string[]): string {
  const seen = field_values.length > 0 ? describe_seen_values(field_values) : 'nothing';
  const expected = rule.values?.length ? `: ${rule.values.join(', ')}` : '';
  return `${rule.field} is ${seen}, which fails ${rule.operation.replaceAll('_', ' ')}${expected}`;
}

function describe_seen_values(values: string[]): string {
  const shown = values
    .slice(0, shown_values_limit)
    .map(
      (value) =>
        `"${value.length > shown_value_length ? `${value.slice(0, shown_value_length)}…` : value}"`,
    );
  const more = values.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

function read_field_values(data: Record<string, unknown>, field: string): string[] {
  const value = read_dot_path(data, field);
  if (value === undefined || value === null) return [];
  const raw_values = Array.isArray(value) ? value : [value];
  return raw_values
    .filter((item) => item !== undefined && item !== null)
    .map((item) => normalize_for_compare(stringify_field_value(item)))
    .filter((item) => item.length > 0);
}

export function read_dot_path(data: Record<string, unknown>, field: string): unknown {
  let current: unknown = data;
  for (const key of field.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringify_field_value(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  return String(value);
}

function normalize_for_compare(value: string): string {
  return value.trim().toLowerCase();
}
