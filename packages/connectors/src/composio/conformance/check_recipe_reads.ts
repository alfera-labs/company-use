import type {
  RecipeReadItem,
  RecipeReadItemsBatch,
} from '@connectors/composio/composio_recipe_types';
import {
  check_node_inputs,
  read_input_max_items,
} from '@connectors/composio/conformance/check_node_inputs';
import type {
  ConformanceProblem,
  NodeLookup,
  ProblemOwner,
  SentInput,
} from '@connectors/composio/conformance/conformance_types';
import {
  element_shape,
  type ShapeScope,
  unchecked_shape,
} from '@connectors/composio/conformance/expression_shape';
import {
  check_expression,
  check_node_status,
  response_shape,
  scope_value_shape,
} from '@connectors/composio/conformance/node_shapes';

type RecipeOwnerBase = Omit<ProblemOwner, 'role' | 'node_key'>;

function sent_expression_inputs(
  owner: ProblemOwner,
  input: Record<string, unknown>,
  scope: ShapeScope,
): { sent: SentInput[]; problems: ConformanceProblem[] } {
  const checked = Object.entries(input).map(([path, expression]) => ({
    path,
    ...check_expression(owner, `input.${path}`, expression, scope),
  }));
  return {
    sent: checked.map(({ path, shape }) => ({ path, shape, supplies_required: true })),
    problems: checked.flatMap((entry) => entry.problems),
  };
}

export function check_read_item(
  lookup: NodeLookup,
  base: RecipeOwnerBase,
  read_item: RecipeReadItem,
  item_scope: ShapeScope,
): ConformanceProblem[] {
  const owner = { ...base, role: 'read_item' as const, node_key: read_item.node_key };
  const node = lookup(read_item.node_key);
  const status_problems = check_node_status(owner, node);
  if (!node) return status_problems;
  const inputs = sent_expression_inputs(owner, read_item.input, item_scope);
  const text_scope = { ...item_scope, response: response_shape(node) };
  return [
    ...status_problems,
    ...inputs.problems,
    ...check_node_inputs(owner, node.input_schema, inputs.sent),
    ...check_expression(owner, 'text', read_item.text, text_scope).problems,
  ];
}

function check_batch_size(
  owner: ProblemOwner,
  batch: RecipeReadItemsBatch,
  input_schema: unknown,
): ConformanceProblem[] {
  const max_items = read_input_max_items(input_schema, batch.ids_param);
  if (max_items === null) return [];
  if (batch.max_batch_size !== undefined && batch.max_batch_size <= max_items) return [];
  return [
    {
      ...owner,
      field: 'max_batch_size',
      expected: `at most ${max_items}, the maxItems of ${batch.ids_param}`,
      actual: batch.max_batch_size === undefined ? 'absent' : String(batch.max_batch_size),
      level: 'error',
    },
  ];
}

export function check_read_items_batch(
  lookup: NodeLookup,
  base: RecipeOwnerBase,
  batch: RecipeReadItemsBatch,
): ConformanceProblem[] {
  const owner = { ...base, role: 'read_items_batch' as const, node_key: batch.node_key };
  const node = lookup(batch.node_key);
  const status_problems = check_node_status(owner, node);
  if (!node) return status_problems;
  const ids: SentInput = {
    path: batch.ids_param.replace(/\[\]$/u, ''),
    shape: { kind: 'list', item: { kind: 'typed', types: ['string'] } },
    supplies_required: true,
  };
  const inputs = sent_expression_inputs(owner, batch.input ?? {}, { scope: scope_value_shape });
  const response = response_shape(node);
  const items = check_expression(owner, 'items', batch.items, { response });
  const item =
    (items.shape.kind === 'missing' ? null : element_shape(items.shape)) ?? unchecked_shape;
  return [
    ...status_problems,
    ...inputs.problems,
    ...check_node_inputs(owner, node.input_schema, [...inputs.sent, ids]),
    ...check_batch_size(owner, batch, node.input_schema),
    ...items.problems,
    ...check_expression(owner, 'identity', batch.identity, { item }).problems,
    ...check_expression(owner, 'text', batch.text, { item, response }).problems,
  ];
}
