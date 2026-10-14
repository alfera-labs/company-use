import type {
  ConformanceProblem,
  ProblemOwner,
  SentInput,
} from '@connectors/composio/conformance/conformance_types';
import { list_shape_types, type Shape } from '@connectors/composio/conformance/expression_shape';
import {
  list_item_branches,
  list_schema_branches,
  list_schema_types,
  type SchemaAt,
  schema_at,
  step_into_schema,
} from '@connectors/composio/conformance/json_schema_paths';
import { is_plain_record } from '@connectors/value_expression';

export function input_root(path: string): string {
  return path.replace(/\[\]$/u, '').split('.')[0]?.replace(/\[\]$/u, '') ?? path;
}

function list_required_inputs(input_schema: unknown): string[] {
  if (!is_plain_record(input_schema) || !Array.isArray(input_schema.required)) return [];
  return input_schema.required.filter((name): name is string => typeof name === 'string');
}

function list_declared_inputs(input_schema: unknown): string[] | null {
  if (!is_plain_record(input_schema) || !is_plain_record(input_schema.properties)) return null;
  return Object.keys(input_schema.properties);
}

function find_input_branches(input_schema: unknown, path: string): SchemaAt[] | null {
  const root = schema_at(input_schema);
  if (!root) return null;
  let branches = list_schema_branches(root);
  for (const step of path.split('.')) {
    const stepped = step_into_schema(branches, step.replace(/\[\]$/u, ''));
    if (stepped.status !== 'found') return null;
    branches = step.endsWith('[]') ? (list_item_branches(stepped.schemas) ?? []) : stepped.schemas;
  }
  return branches;
}

export function read_input_max_items(input_schema: unknown, path: string): number | null {
  const branches = find_input_branches(input_schema, path.replace(/\[\]$/u, ''));
  const limits = (branches ?? []).flatMap((branch) =>
    typeof branch.schema.maxItems === 'number' ? [branch.schema.maxItems] : [],
  );
  return limits.length > 0 ? Math.min(...limits) : null;
}

function types_fit(expected: readonly string[], actual: readonly string[]): boolean {
  if (expected.length === 0 || actual.length === 0) return true;
  const widened = new Set(
    actual.flatMap((type) =>
      type === 'integer' || type === 'number' ? ['integer', 'number'] : [type],
    ),
  );
  return expected.some((type) => widened.has(type));
}

function list_enum_values(branches: readonly SchemaAt[]): unknown[] | null {
  const values = branches.flatMap((branch) =>
    Array.isArray(branch.schema.enum) ? branch.schema.enum : [],
  );
  return values.length > 0 ? values : null;
}

function check_value_type(
  input_schema: unknown,
  sent: SentInput,
): Omit<ConformanceProblem, keyof ProblemOwner> | null {
  const branches = find_input_branches(input_schema, sent.path);
  if (!branches || branches.length === 0) return null;
  const expected = list_schema_types(branches);
  const actual = list_shape_types(sent.shape);
  if (!types_fit(expected, actual)) {
    return {
      field: sent.path,
      expected: `type ${expected.join('|')}`,
      actual: `type ${actual.join('|')}`,
      level: 'error',
    };
  }
  const allowed = list_enum_values(branches);
  if (allowed && sent.shape.kind === 'literal' && !allowed.includes(sent.shape.value)) {
    return {
      field: sent.path,
      expected: `one of ${allowed.map(String).join(', ')}`,
      actual: String(sent.shape.value),
      level: 'error',
    };
  }
  return null;
}

export function check_node_inputs(
  owner: ProblemOwner,
  input_schema: unknown,
  sent_inputs: readonly SentInput[],
): ConformanceProblem[] {
  const problems: ConformanceProblem[] = [];
  const supplied = new Set(
    sent_inputs.filter((sent) => sent.supplies_required).map((sent) => input_root(sent.path)),
  );
  for (const name of list_required_inputs(input_schema)) {
    if (supplied.has(name)) continue;
    problems.push({
      ...owner,
      field: name,
      expected: 'required input supplied',
      actual: 'not sent',
      level: 'error',
    });
  }
  const declared = list_declared_inputs(input_schema);
  for (const sent of sent_inputs) {
    if (declared && !declared.includes(input_root(sent.path))) {
      const expected = `one of ${declared.join(', ') || '(no inputs)'}`;
      problems.push({
        ...owner,
        field: sent.path,
        expected,
        actual: 'undeclared input',
        level: 'error',
      });
      continue;
    }
    const mismatch = check_value_type(input_schema, sent);
    if (mismatch) problems.push({ ...owner, ...mismatch });
  }
  return problems;
}

export function sent_runtime_string(path: string, supplies_required: boolean): SentInput {
  const shape: Shape = { kind: 'typed', types: ['string'] };
  return { path, shape, supplies_required };
}
