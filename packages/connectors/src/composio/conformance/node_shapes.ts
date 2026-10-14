import type {
  ConformanceNode,
  ConformanceProblem,
  ProblemOwner,
} from '@connectors/composio/conformance/conformance_types';
import {
  type PathRead,
  type Shape,
  type ShapeScope,
  shape_of_expression,
} from '@connectors/composio/conformance/expression_shape';
import {
  list_schema_branches,
  schema_at,
  step_into_schema,
} from '@connectors/composio/conformance/json_schema_paths';

export const open_schema_detail = 'schema is open, cannot verify';

export const scope_value_shape: Shape = {
  kind: 'record',
  fields: { id: { kind: 'typed', types: ['string'] }, label: { kind: 'typed', types: ['string'] } },
};

export function response_shape(node: ConformanceNode): Shape {
  const root = schema_at(node.output_schema);
  if (!root) return { kind: 'open' };
  const stepped = step_into_schema(list_schema_branches(root), 'data');
  if (stepped.status === 'found') return { kind: 'schema', schemas: stepped.schemas };
  return { kind: 'open' };
}

export function reads_to_problems(
  owner: ProblemOwner,
  field: string,
  reads: readonly PathRead[],
): ConformanceProblem[] {
  return reads
    .filter((read) => read.outcome === 'missing' || read.outcome === 'open')
    .map((read) => ({
      ...owner,
      field: `${field}: ${read.path}`,
      expected: read.outcome === 'missing' ? 'path in output_schema' : 'a typed path',
      actual:
        read.outcome === 'missing'
          ? `missing (has ${read.available.slice(0, 12).join(', ') || 'nothing'})`
          : open_schema_detail,
      level: read.outcome === 'missing' ? 'error' : 'warning',
    }));
}

export function check_expression(
  owner: ProblemOwner,
  field: string,
  expression: unknown,
  scope: ShapeScope,
): { shape: Shape; problems: ConformanceProblem[] } {
  const reads: PathRead[] = [];
  const shape = shape_of_expression(expression, scope, reads);
  return { shape, problems: reads_to_problems(owner, field, reads) };
}

export function check_node_status(
  owner: ProblemOwner,
  node: ConformanceNode | undefined,
): ConformanceProblem[] {
  if (!node) {
    return [
      {
        ...owner,
        field: 'node_key',
        expected: 'node in catalog',
        actual: 'missing',
        level: 'error',
      },
    ];
  }
  if (node.node_status === 'active') return [];
  const successor = node.successor_node_key ?? 'none recorded';
  return [
    {
      ...owner,
      field: 'node_status',
      expected: 'active',
      actual: `${node.node_status}, successor ${successor}`,
      level: 'error',
    },
  ];
}
