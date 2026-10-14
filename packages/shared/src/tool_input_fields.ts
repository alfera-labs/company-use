import { z } from 'zod';

const field_bag = z.record(z.string(), z.unknown());

export type ToolInputField = {
  key: string;
  label: string;
  value: string;
  is_long: boolean;
};

type SchemaProperty = {
  title?: string;
  description?: string;
  type?: string;
  default?: unknown;
};

type InputSchema = {
  properties?: Record<string, SchemaProperty>;
};

const plumbing_field_keys = new Set([
  'schema_id',
  'dynamic_props_id',
  'stash_id',
  'output_fields',
  'source_event_id',
]);

const long_value_length = 80;
const max_fields = 12;
const max_unnamed_fields = 4;

export function read_tool_input_fields(
  input: unknown,
  schema?: unknown,
  display_fields?: readonly string[] | null | undefined,
): ToolInputField[] {
  if (typeof input === 'string') {
    return input.trim() ? [make_field('value', 'Details', input)] : [];
  }
  const input_fields = field_bag.safeParse(input);
  if (!input_fields.success) return [];

  const properties = read_schema_properties(schema);
  const named = (display_fields ?? []).filter((key) => key in input_fields.data);
  const keys = named.length > 0 ? named : order_keys(Object.keys(input_fields.data), properties);
  const limit = named.length > 0 ? max_fields : max_unnamed_fields;
  const money = read_money(input_fields.data);
  const fields: ToolInputField[] = [];
  for (const key of keys) {
    if (plumbing_field_keys.has(key)) continue;
    if (money && key === money.currency_key) continue;
    if (named.length === 0 && is_the_schema_default(input_fields.data[key], properties[key]))
      continue;
    const value =
      money && key === money.amount_key ? money.text : format_value(input_fields.data[key]);
    if (!value) continue;
    fields.push(make_field(key, read_label(key, properties[key]), value));
    if (fields.length === limit) break;
  }
  return fields;
}

function is_the_schema_default(value: unknown, property: SchemaProperty | undefined) {
  if (!property || !('default' in property)) return false;
  return JSON.stringify(value) === JSON.stringify(property.default);
}

const amount_field_keys = ['amount', 'amount_pennies', 'amount_cents', 'total', 'price', 'value'];
const minor_unit_field_keys = new Set(['amount_pennies', 'amount_cents']);
const currency_code_re = /^[A-Z]{3}$/u;

function read_money(input: Record<string, unknown>) {
  const currency_key = Object.keys(input).find(
    (key) => typeof input[key] === 'string' && currency_code_re.test(input[key] as string),
  );
  if (!currency_key) return null;

  const amount_key = amount_field_keys.find((key) => typeof input[key] === 'number');
  if (!amount_key) return null;

  const raw = input[amount_key] as number;
  const amount = minor_unit_field_keys.has(amount_key) ? raw / 100 : raw;
  try {
    return {
      amount_key,
      currency_key,
      text: new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: input[currency_key] as string,
      }).format(amount),
    };
  } catch {
    return null;
  }
}

function make_field(key: string, label: string, value: string): ToolInputField {
  return { key, label, value, is_long: value.length > long_value_length || value.includes('\n') };
}

function order_keys(keys: string[], properties: Record<string, SchemaProperty>) {
  const schema_order = Object.keys(properties).filter((key) => keys.includes(key));
  return [...schema_order, ...keys.filter((key) => !schema_order.includes(key))];
}

function read_label(key: string, property: SchemaProperty | undefined) {
  const title = property?.title?.trim();
  if (title) return title;
  return humanize_key(key);
}

function humanize_key(key: string) {
  const words = key
    .replace(/_(id|ids|ts|key|keys|url|uri)$/u, '')
    .split(/[_\s]+/u)
    .filter(Boolean);
  if (words.length === 0) return key;
  const [first = '', ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

function format_value(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return format_list(value);
  const nested = field_bag.safeParse(value);
  if (nested.success) return format_nested(nested.data);
  return '';
}

function format_list(values: unknown[]) {
  const scalars = values.map(format_scalar).filter(Boolean);
  if (scalars.length === values.length) return scalars.join(', ');
  return `${values.length} item${values.length === 1 ? '' : 's'}`;
}

function format_nested(value: Record<string, unknown>) {
  const parts = Object.entries(value)
    .map(([key, entry]) => {
      const scalar = format_scalar(entry);
      return scalar ? `${humanize_key(key)}: ${scalar}` : '';
    })
    .filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  const count = Object.keys(value).length;
  return count > 0 ? `${count} detail${count === 1 ? '' : 's'}` : '';
}

function format_scalar(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '';
}

function read_schema_properties(schema: unknown): Record<string, SchemaProperty> {
  const parsed = field_bag.safeParse(schema);
  if (!parsed.success) return {};
  const properties = field_bag.safeParse((parsed.data as InputSchema).properties);
  return properties.success ? (properties.data as Record<string, SchemaProperty>) : {};
}
