import type {
  ComposioRecipeDimension,
  RecipeNodeCall,
} from '@connectors/composio/composio_recipe_types';
import { find_browse_item_shape } from '@connectors/composio/conformance/browse_item_shape';
import {
  check_node_inputs,
  sent_runtime_string,
} from '@connectors/composio/conformance/check_node_inputs';
import type {
  ConformanceProblem,
  NodeLookup,
  ProblemOwner,
  SentInput,
} from '@connectors/composio/conformance/conformance_types';
import {
  element_shape,
  type Shape,
  unchecked_shape,
} from '@connectors/composio/conformance/expression_shape';
import {
  check_expression,
  check_node_status,
  response_shape,
} from '@connectors/composio/conformance/node_shapes';
import type { RecipeNodeRole } from '@connectors/composio/list_recipe_node_references';

const default_option_mapping = { id: { $: 'item.id' }, label: { $: 'item.label' } };

function literal_inputs(input: Record<string, unknown> | undefined): SentInput[] {
  return Object.entries(input ?? {}).map(([path, value]) => ({
    path,
    shape: { kind: 'literal', value },
    supplies_required: true,
  }));
}

function read_option_items(
  owner: ProblemOwner,
  dimension: ComposioRecipeDimension,
  response: Shape,
) {
  if (dimension.option_items === undefined) {
    return { ...find_browse_item_shape(response), problems: [] };
  }
  const listed = check_expression(owner, 'option_items', dimension.option_items, { response });
  const { problems } = listed;
  if (listed.shape.kind === 'missing') return { item: unchecked_shape, problem: null, problems };
  const item = element_shape(listed.shape);
  return { item, problem: item ? null : 'option_items is not an array', problems };
}

function check_browse_output(
  owner: ProblemOwner,
  dimension: ComposioRecipeDimension,
  response: Shape,
) {
  const { item, problem, problems: item_problems } = read_option_items(owner, dimension, response);
  if (!item) {
    const expected =
      'option_items, response.options, response.items, a bare array, or exactly one top-level array';
    return [
      ...item_problems,
      {
        ...owner,
        field: 'browse items',
        expected,
        actual: problem ?? 'none',
        level: 'error' as const,
      },
    ];
  }
  const mapping = dimension.option_mapping ?? default_option_mapping;
  const problems: ConformanceProblem[] = [
    ...item_problems,
    ...check_expression(owner, 'option_when', dimension.option_when, { item }).problems,
  ];
  for (const key of ['id', 'label']) {
    if (key in mapping) continue;
    problems.push({
      ...owner,
      field: `option_mapping.${key}`,
      expected: 'mapped',
      actual: 'absent',
      level: 'error',
    });
  }
  for (const [key, expression] of Object.entries(mapping)) {
    problems.push(
      ...check_expression(owner, `option_mapping.${key}`, expression, { item }).problems,
    );
  }
  return problems;
}

function check_browse_call(
  lookup: NodeLookup,
  base: Omit<ProblemOwner, 'role' | 'node_key'>,
  role: RecipeNodeRole,
  call: RecipeNodeCall,
  dimension: ComposioRecipeDimension,
  extra_inputs: readonly SentInput[],
): ConformanceProblem[] {
  const owner = { ...base, role, node_key: call.node_key };
  const node = lookup(call.node_key);
  const status_problems = check_node_status(owner, node);
  if (!node) return status_problems;
  const sent = [...literal_inputs(call.input), ...extra_inputs];
  return [
    ...status_problems,
    ...check_node_inputs(owner, node.input_schema, sent),
    ...check_browse_output(owner, dimension, response_shape(node)),
  ];
}

type BrowseCall = { role: RecipeNodeRole; call: RecipeNodeCall; extra_inputs: SentInput[] };

function list_browse_calls(dimension: ComposioRecipeDimension): BrowseCall[] {
  const calls: BrowseCall[] = [];
  if (dimension.list_scope_options) {
    const search_param = dimension.search_param;
    const extra_inputs = search_param
      ? [sent_runtime_string(search_param, dimension.shape === 'query')]
      : [];
    calls.push({ role: 'list_scope_options', call: dimension.list_scope_options, extra_inputs });
  }
  if (dimension.list_children) {
    const extra_inputs = [sent_runtime_string(dimension.list_children.parent_id_param, true)];
    calls.push({ role: 'list_children', call: dimension.list_children, extra_inputs });
  }
  if (dimension.search) {
    const extra_inputs = [sent_runtime_string(dimension.search.query_param, true)];
    calls.push({ role: 'search', call: dimension.search, extra_inputs });
  }
  return calls;
}

function check_scope_options_present(
  base: Omit<ProblemOwner, 'role' | 'node_key'>,
  dimension: ComposioRecipeDimension,
): ConformanceProblem[] {
  if (dimension.list_scope_options || dimension.implicit_single_account) return [];
  const is_query = dimension.shape === 'query';
  return [
    {
      ...base,
      role: 'dimension',
      node_key: '-',
      field: 'list_scope_options',
      expected: 'present',
      actual: is_query
        ? 'absent, the typed query is the only scope'
        : 'absent, select_all finds no scope',
      level: is_query ? 'warning' : 'error',
    },
  ];
}

export function check_recipe_dimension(
  lookup: NodeLookup,
  toolkit_slug: string,
  dimension: ComposioRecipeDimension,
): ConformanceProblem[] {
  const base = { toolkit_slug, owner_key: dimension.key };
  return [
    ...check_scope_options_present(base, dimension),
    ...list_browse_calls(dimension).flatMap(({ role, call, extra_inputs }) =>
      check_browse_call(lookup, base, role, call, dimension, extra_inputs),
    ),
  ];
}
