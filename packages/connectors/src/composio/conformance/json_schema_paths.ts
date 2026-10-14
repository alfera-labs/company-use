import { is_plain_record } from '@connectors/value_expression';

type SchemaRecord = Record<string, unknown>;

export type SchemaAt = { schema: SchemaRecord; root: SchemaRecord };

export type SchemaStep =
  | { status: 'found'; schemas: SchemaAt[] }
  | { status: 'open' }
  | { status: 'missing'; available: string[] };

const max_ref_depth = 20;

export function schema_at(schema: unknown, root: unknown = schema): SchemaAt | null {
  if (!is_plain_record(schema)) return null;
  return { schema, root: is_plain_record(root) ? root : schema };
}

function follow_ref(at: SchemaAt): SchemaAt | null {
  const ref = at.schema.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return at;
  let current: unknown = at.root;
  for (const step of ref.slice(2).split('/')) {
    current = is_plain_record(current) ? current[step] : undefined;
  }
  return schema_at(current, at.root);
}

function is_null_schema(schema: SchemaRecord): boolean {
  return schema.type === 'null';
}

export function list_schema_branches(at: SchemaAt, depth = 0): SchemaAt[] {
  const resolved = follow_ref(at);
  if (!resolved || depth > max_ref_depth) return [];
  const alternatives = ['anyOf', 'oneOf', 'allOf'].flatMap((keyword) => {
    const options = resolved.schema[keyword];
    return Array.isArray(options) ? options : [];
  });
  if (alternatives.length === 0) return is_null_schema(resolved.schema) ? [] : [resolved];
  const branches = alternatives
    .map((option) => schema_at(option, resolved.root))
    .filter((option): option is SchemaAt => option !== null)
    .flatMap((option) => list_schema_branches(option, depth + 1));
  const own_properties = is_plain_record(resolved.schema.properties) ? [resolved] : [];
  return [...own_properties, ...branches];
}

function list_types(schema: SchemaRecord): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) return schema.type.filter((type) => typeof type === 'string');
  return [];
}

export function list_schema_types(branches: readonly SchemaAt[]): string[] {
  return [...new Set(branches.flatMap((branch) => list_types(branch.schema)))];
}

function is_array_schema(schema: SchemaRecord): boolean {
  return list_types(schema).includes('array') || schema.items !== undefined;
}

export function is_open_schema(schema: SchemaRecord): boolean {
  if (is_plain_record(schema.properties) && Object.keys(schema.properties).length > 0) {
    return is_plain_record(schema.additionalProperties) || schema.additionalProperties === true;
  }
  if (is_array_schema(schema)) return false;
  const types = list_types(schema);
  return types.length === 0 || types.includes('object');
}

export function list_item_branches(branches: readonly SchemaAt[]): SchemaAt[] | null {
  const arrays = branches.filter((branch) => is_array_schema(branch.schema));
  if (arrays.length === 0) return null;
  return arrays.flatMap((branch) => {
    const items = schema_at(branch.schema.items, branch.root);
    return items ? list_schema_branches(items) : [];
  });
}

function step_into_branch(branch: SchemaAt, step: string): SchemaAt[] | 'open' {
  const { schema, root } = branch;
  const properties = is_plain_record(schema.properties) ? schema.properties : {};
  const child = schema_at(properties[step], root);
  if (child) return list_schema_branches(child);
  if (is_array_schema(schema) && /^\d+$/u.test(step)) return list_item_branches([branch]) ?? [];
  const extra = schema_at(schema.additionalProperties, root);
  if (extra) return list_schema_branches(extra);
  return is_open_schema(schema) ? 'open' : [];
}

function list_property_names(branches: readonly SchemaAt[]): string[] {
  return [
    ...new Set(
      branches.flatMap((branch) =>
        is_plain_record(branch.schema.properties) ? Object.keys(branch.schema.properties) : [],
      ),
    ),
  ];
}

export function step_into_schema(branches: readonly SchemaAt[], step: string): SchemaStep {
  const results = branches.map((branch) => step_into_branch(branch, step));
  const found = results.flatMap((result) => (result === 'open' ? [] : result));
  if (found.length > 0) return { status: 'found', schemas: found };
  if (results.includes('open')) return { status: 'open' };
  return { status: 'missing', available: list_property_names(branches) };
}
