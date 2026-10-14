import {
  list_item_branches,
  list_schema_types,
  type SchemaAt,
  step_into_schema,
} from '@connectors/composio/conformance/json_schema_paths';
import { is_plain_record } from '@connectors/value_expression';

export type Shape =
  | { kind: 'schema'; schemas: SchemaAt[] }
  | { kind: 'typed'; types: string[] }
  | { kind: 'literal'; value: unknown }
  | { kind: 'record'; fields: Record<string, Shape> }
  | { kind: 'list'; item: Shape }
  | { kind: 'open' }
  | { kind: 'unchecked' }
  | { kind: 'missing' };

export type PathRead = {
  path: string;
  outcome: 'found' | 'open' | 'missing' | 'unchecked';
  available: string[];
};

export type ShapeScope = Record<string, Shape>;

const open_shape: Shape = { kind: 'open' };
const missing_shape: Shape = { kind: 'missing' };
export const unchecked_shape: Shape = { kind: 'unchecked' };

function step_into_shape(shape: Shape, step: string): { shape: Shape; available: string[] } {
  if (shape.kind === 'schema') {
    const stepped = step_into_schema(shape.schemas, step);
    if (stepped.status === 'found')
      return { shape: { kind: 'schema', schemas: stepped.schemas }, available: [] };
    if (stepped.status === 'open') return { shape: open_shape, available: [] };
    return { shape: missing_shape, available: stepped.available };
  }
  if (shape.kind === 'record') {
    const field = shape.fields[step];
    return { shape: field ?? missing_shape, available: field ? [] : Object.keys(shape.fields) };
  }
  if (shape.kind === 'unchecked') return { shape: unchecked_shape, available: [] };
  if (shape.kind === 'list' && /^\d+$/u.test(step)) return { shape: shape.item, available: [] };
  if (shape.kind === 'open' || shape.kind === 'typed') return { shape: open_shape, available: [] };
  return { shape: missing_shape, available: [] };
}

export function resolve_shape_path(scope: ShapeScope, dotted_path: string) {
  const [root = '', ...steps] = dotted_path.split('.');
  let shape: Shape = scope[root] ?? missing_shape;
  let available = shape.kind === 'missing' ? Object.keys(scope) : [];
  for (const step of steps) {
    if (shape.kind === 'missing') break;
    ({ shape, available } = step_into_shape(shape, step));
  }
  return { shape, available };
}

export function element_shape(shape: Shape): Shape | null {
  if (shape.kind === 'list') return shape.item;
  if (shape.kind === 'open' || shape.kind === 'unchecked') return shape;
  if (shape.kind !== 'schema') return null;
  const items = list_item_branches(shape.schemas);
  if (!items) return null;
  return items.length > 0 ? { kind: 'schema', schemas: items } : open_shape;
}

function read_outcome(shape: Shape): PathRead['outcome'] {
  if (shape.kind === 'missing' || shape.kind === 'open' || shape.kind === 'unchecked') {
    return shape.kind;
  }
  return 'found';
}

function shape_of_reference(path: unknown, scope: ShapeScope, reads: PathRead[]): Shape {
  if (typeof path !== 'string') return missing_shape;
  const { shape, available } = resolve_shape_path(scope, path);
  reads.push({ path, outcome: read_outcome(shape), available });
  return shape;
}

function shape_of_map(argument: unknown, scope: ShapeScope, reads: PathRead[]): Shape {
  if (!is_plain_record(argument)) return missing_shape;
  const source = shape_of_expression(argument.from, scope, reads);
  const item = source.kind === 'missing' ? unchecked_shape : element_shape(source);
  if (item === null) {
    reads.push({ path: '$map.from', outcome: 'missing', available: ['<an array>'] });
  }
  return {
    kind: 'list',
    item: shape_of_expression(
      argument.to,
      { ...scope, item: item ?? open_shape, ...(scope.item ? { parent: scope.item } : {}) },
      reads,
    ),
  };
}

function shape_of_default(argument: unknown, scope: ShapeScope, reads: PathRead[]): Shape {
  const candidates = Array.isArray(argument) ? argument : [];
  const shapes = candidates.map((candidate) => shape_of_expression(candidate, scope, reads));
  return shapes.find((shape) => shape.kind !== 'missing') ?? missing_shape;
}

function shape_of_join(argument: unknown, scope: ShapeScope, reads: PathRead[]): Shape {
  const parts = is_plain_record(argument) && Array.isArray(argument.parts) ? argument.parts : [];
  for (const part of parts) shape_of_expression(part, scope, reads);
  return { kind: 'typed', types: ['string'] };
}

export function shape_of_expression(
  expression: unknown,
  scope: ShapeScope,
  reads: PathRead[],
): Shape {
  if (Array.isArray(expression)) {
    const items = expression.map((entry) => shape_of_expression(entry, scope, reads));
    return { kind: 'list', item: items[0] ?? open_shape };
  }
  if (!is_plain_record(expression)) return { kind: 'literal', value: expression };
  if ('$' in expression) return shape_of_reference(expression.$, scope, reads);
  if ('$map' in expression) return shape_of_map(expression.$map, scope, reads);
  if ('$default' in expression) return shape_of_default(expression.$default, scope, reads);
  if ('$literal' in expression) return { kind: 'literal', value: expression.$literal };
  if ('$join' in expression) return shape_of_join(expression.$join, scope, reads);
  const fields: Record<string, Shape> = {};
  for (const [key, value] of Object.entries(expression)) {
    fields[key] = shape_of_expression(value, scope, reads);
  }
  return { kind: 'record', fields };
}

function literal_types(value: unknown): string[] {
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array'];
  if (typeof value === 'number')
    return Number.isInteger(value) ? ['integer', 'number'] : ['number'];
  return [typeof value];
}

export function list_shape_types(shape: Shape): string[] {
  if (shape.kind === 'schema') return list_schema_types(shape.schemas);
  if (shape.kind === 'typed') return shape.types;
  if (shape.kind === 'literal') return literal_types(shape.value);
  if (shape.kind === 'record') return ['object'];
  if (shape.kind === 'list') return ['array'];
  return [];
}
