import type { Shape } from '@connectors/composio/conformance/expression_shape';
import type { RecipeNodeRole } from '@connectors/composio/list_recipe_node_references';

export type ConformanceNode = {
  node_key: string;
  node_status: string;
  successor_node_key: string | null;
  input_schema: unknown;
  output_schema: unknown;
  output_source: 'catalog' | 'composio';
};

export type ConformanceProblem = {
  toolkit_slug: string;
  owner_key: string;
  role: RecipeNodeRole | 'object' | 'dimension';
  node_key: string;
  field: string;
  expected: string;
  actual: string;
  level: 'error' | 'warning';
};

export type SentInput = {
  path: string;
  shape: Shape;
  supplies_required: boolean;
};

export type ProblemOwner = Pick<
  ConformanceProblem,
  'toolkit_slug' | 'owner_key' | 'role' | 'node_key'
>;

export type NodeLookup = (node_key: string) => ConformanceNode | undefined;
