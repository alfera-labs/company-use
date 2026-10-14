import type { ComposioRecipeObject } from '@connectors/composio/composio_recipe_types';
import { check_node_inputs } from '@connectors/composio/conformance/check_node_inputs';
import { check_page } from '@connectors/composio/conformance/check_recipe_page';
import { check_recipe_path } from '@connectors/composio/conformance/check_recipe_path';
import {
  check_read_item,
  check_read_items_batch,
} from '@connectors/composio/conformance/check_recipe_reads';
import type {
  ConformanceProblem,
  NodeLookup,
  ProblemOwner,
} from '@connectors/composio/conformance/conformance_types';
import {
  element_shape,
  type Shape,
  type ShapeScope,
  unchecked_shape,
} from '@connectors/composio/conformance/expression_shape';
import { list_items_inputs } from '@connectors/composio/conformance/list_items_inputs';
import {
  check_expression,
  check_node_status,
  response_shape,
  scope_value_shape,
} from '@connectors/composio/conformance/node_shapes';

function list_item_expressions(object: ComposioRecipeObject): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [
    ['identity', object.identity],
    ['title', object.title],
    ['content', object.content],
    ['version_signal', object.version_signal],
    ['tombstone', object.tombstone],
    ['when', object.when],
    ['cursor.field', object.cursor?.field],
    ['container.id', object.container?.id],
    ['container.path', object.container?.path],
    ['source_url', object.source_url],
    ['files', object.files],
    ['bucket', object.bucket?.by === 'day' ? object.bucket.of : object.bucket?.key],
    ...Object.entries(object.metadata ?? {}).map(([key, value]): [string, unknown] => [
      `metadata.${key}`,
      value,
    ]),
    ...Object.entries(object.relationships ?? {}).map(([key, value]): [string, unknown] => [
      `relationships.${key}`,
      value,
    ]),
  ];
  return entries.filter(([, expression]) => expression !== undefined);
}

function unique_problems(problems: readonly ConformanceProblem[]): ConformanceProblem[] {
  const seen = new Map(problems.map((problem) => [JSON.stringify(problem), problem]));
  return [...seen.values()];
}

function check_implicit_scopes(
  owner: ProblemOwner,
  object: ComposioRecipeObject,
  implicit_dimension_keys: ReadonlySet<string>,
): ConformanceProblem[] {
  return Object.entries(object.scoped_by)
    .filter(([key, scope_path]) => implicit_dimension_keys.has(key) && scope_path !== null)
    .map(([key, scope_path]) => ({
      ...owner,
      field: `scoped_by.${key}: ${scope_path}`,
      expected: 'null for an implicit_single_account dimension',
      actual: `sends the synthetic scope id "${key}"`,
      level: 'warning' as const,
    }));
}

function check_list_items(lookup: NodeLookup, owner: ProblemOwner, object: ComposioRecipeObject) {
  const node = lookup(owner.node_key);
  const status_problems = check_node_status(owner, node);
  if (!node) return { item: unchecked_shape, problems: status_problems };
  const input_problems = Object.values(object.scoped_by).flatMap((scope_path) =>
    check_node_inputs(owner, node.input_schema, list_items_inputs(object, scope_path)),
  );
  const page = check_page(owner, object.page, response_shape(node));
  return {
    item: page.item,
    problems: [...status_problems, ...unique_problems(input_problems), ...page.problems],
  };
}

export function check_recipe_object(
  lookup: NodeLookup,
  toolkit_slug: string,
  object_key: string,
  object: ComposioRecipeObject,
  implicit_dimension_keys: ReadonlySet<string> = new Set(),
): ConformanceProblem[] {
  const base = { toolkit_slug, owner_key: object_key };
  const owner = { ...base, role: 'list_items' as const, node_key: object.list_items.node_key };
  const listed = check_list_items(lookup, owner, object);
  const scope: ShapeScope = { item: listed.item, scope: scope_value_shape };
  const problems = [
    ...listed.problems,
    ...check_implicit_scopes(owner, object, implicit_dimension_keys),
  ];
  for (const [field, expression] of list_item_expressions(object)) {
    problems.push(...check_expression(owner, field, expression, scope).problems);
  }
  if (!object.read_item && !object.read_items_batch && object.content === undefined) {
    problems.push({
      ...base,
      role: 'object',
      node_key: '-',
      field: 'read_item, read_items_batch, or content',
      expected: 'present',
      actual: 'absent',
      level: 'error',
    });
  }
  if (object.listing_limit_note) {
    problems.push({
      ...owner,
      field: 'listing_limit_note',
      expected: 'a listing that reaches every item',
      actual: object.listing_limit_note,
      level: 'warning',
    });
  }
  if (object.path) problems.push(...check_recipe_path(lookup, base, object.path, scope));
  if (object.read_item) problems.push(...check_read_item(lookup, base, object.read_item, scope));
  if (object.read_items_batch)
    problems.push(...check_read_items_batch(lookup, base, object.read_items_batch));
  return problems;
}
