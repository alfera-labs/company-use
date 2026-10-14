import { is_api_proxy_runtime_handler } from '@coworker/core/integrations/provider_runtime_handlers';
import type { ConnectionSnapshotItem } from '@runtime-platform/connections/connection_snapshot';

type CatalogSearchTool = {
  node_id: string;
  runtime_handler: string;
  metadata: unknown;
};

const read_operation_terms = new Set([
  'fetch',
  'find',
  'get',
  'list',
  'lookup',
  'read',
  'retrieve',
  'search',
]);

export function find_connected_app_name(
  query: string,
  connections: ConnectionSnapshotItem[],
): string | undefined {
  const normalized_query = normalize_reference(query);
  const scores = new Map<string, number>();

  for (const connection of connections) {
    if (!connection.accessible || connection.connection_status !== 'active') continue;
    const score = connection_match_score(normalized_query, connection);
    if (score > (scores.get(connection.app_name) ?? 0)) scores.set(connection.app_name, score);
  }

  const ranked = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (!ranked[0] || ranked[0][1] === ranked[1]?.[1]) return undefined;
  return ranked[0][0];
}

export function select_catalog_api_fallbacks<T extends CatalogSearchTool>(input: {
  query: string;
  offset: number;
  selected_app_name?: string;
  tools: T[];
  fallback_tools: T[];
}): T[] {
  if (input.offset > 0) return [];
  if (!input.selected_app_name) return [];
  if (input.tools.some(is_api_proxy)) return [];
  if (input.tools.length > 0 && !query_requests_api_proxy(input.query)) return [];

  const method = requested_proxy_method(input.query);
  return method
    ? input.fallback_tools.filter((tool) => read_proxy_method(tool) === method)
    : input.fallback_tools;
}

function connection_match_score(query: string, connection: ConnectionSnapshotItem) {
  if (
    reference_is_in_query(query, connection.app_name) ||
    reference_is_in_query(query, connection.app_display_name)
  ) {
    return 2;
  }
  return reference_is_in_query(query, connection.app_category) ? 1 : 0;
}

function reference_is_in_query(query: string, reference: string) {
  const normalized_reference = normalize_reference(reference);
  return normalized_reference.length > 1 && ` ${query} `.includes(` ${normalized_reference} `);
}

function normalize_reference(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function query_requests_api_proxy(query: string) {
  const terms = new Set(normalize_reference(query).split(' '));
  return terms.has('api') || terms.has('proxy');
}

function requested_proxy_method(query: string) {
  const terms = new Set(normalize_reference(query).split(' '));
  for (const method of ['delete', 'get', 'patch', 'post', 'put']) {
    if (terms.has(method)) return method;
  }
  return [...terms].some((term) => read_operation_terms.has(term)) ? 'get' : undefined;
}

function is_api_proxy(tool: CatalogSearchTool) {
  return is_api_proxy_runtime_handler(tool.runtime_handler);
}

function read_proxy_method(tool: CatalogSearchTool) {
  if (!tool.metadata || typeof tool.metadata !== 'object') return undefined;
  const method = (tool.metadata as Record<string, unknown>).proxy_method;
  return typeof method === 'string' ? method : undefined;
}
