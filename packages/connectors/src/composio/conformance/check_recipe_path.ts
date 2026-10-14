import type { ComposioRecipeObject } from '@connectors/composio/composio_recipe_types';
import { check_node_inputs } from '@connectors/composio/conformance/check_node_inputs';
import { check_page } from '@connectors/composio/conformance/check_recipe_page';
import type {
  ConformanceProblem,
  NodeLookup,
  ProblemOwner,
  SentInput,
} from '@connectors/composio/conformance/conformance_types';
import type { ShapeScope } from '@connectors/composio/conformance/expression_shape';
import { page_inputs } from '@connectors/composio/conformance/list_items_inputs';
import {
  check_expression,
  check_node_status,
  response_shape,
} from '@connectors/composio/conformance/node_shapes';
import type { ConnectorFolderListing } from '@connectors/sync/record_path_types';

type RecipePath = NonNullable<ComposioRecipeObject['path']>;
type RecipeOwnerBase = Omit<ProblemOwner, 'role' | 'node_key'>;

function segment_expression(segment: unknown): unknown {
  if (typeof segment === 'object' && segment !== null && 'text' in segment) return segment.text;
  return segment;
}

function folder_listing_inputs(listing: ConnectorFolderListing): SentInput[] {
  const literals = Object.entries(listing.input ?? {}).map(
    ([path, value]): SentInput => ({
      path,
      shape: { kind: 'literal', value },
      supplies_required: true,
    }),
  );
  return [...literals, ...page_inputs(listing.page)];
}

function check_folder_listing(
  lookup: NodeLookup,
  base: RecipeOwnerBase,
  listing: ConnectorFolderListing,
): ConformanceProblem[] {
  const owner = { ...base, role: 'list_folders' as const, node_key: listing.node_key };
  const node = lookup(listing.node_key);
  const status_problems = check_node_status(owner, node);
  if (!node) return status_problems;
  const page = check_page(owner, listing.page, response_shape(node));
  const folder_scope: ShapeScope = { item: page.item };
  const field_problems = (['id', 'name', 'parent_id', 'when'] as const)
    .filter((field) => listing[field] !== undefined)
    .flatMap((field) => check_expression(owner, field, listing[field], folder_scope).problems);
  return [
    ...status_problems,
    ...check_node_inputs(owner, node.input_schema, folder_listing_inputs(listing)),
    ...page.problems,
    ...field_problems,
  ];
}

export function check_recipe_path(
  lookup: NodeLookup,
  base: RecipeOwnerBase,
  path: RecipePath,
  item_scope: ShapeScope,
): ConformanceProblem[] {
  const owner = { ...base, role: 'list_items' as const, node_key: '-' };
  const segment_problems = (path.segments ?? []).flatMap(
    (segment, index) =>
      check_expression(owner, `path.segments.${index}`, segment_expression(segment), item_scope)
        .problems,
  );
  const chain = path.parent_chain;
  if (!chain) return segment_problems;
  return [
    ...segment_problems,
    ...check_expression(owner, 'path.parent_chain.parent_ids', chain.parent_ids, item_scope)
      .problems,
    ...check_folder_listing(lookup, base, chain.folders),
  ];
}
