import { evaluate_browse_request } from '@connectors/browse_request';
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { get_connector_app } from '@connectors/registry';
import { execute_node } from '@connectors/runtime/execute_node';
import type { ConnectorSyncDimension, ConnectorSyncObject } from '@connectors/sync_types';
import type { ConnectorConnection, ConnectorResult } from '@connectors/types';
import { evaluate_value_expression } from '@connectors/value_expression';
import type { JsonSchema } from '@coworker/shared';
import { format_error_message } from '@coworker/shared';

export type ScopeOption = {
  id: string;
  label: string;
  sublabel?: string | number;
  preview?: string;
  kind?: string;
  has_children?: boolean;
  selectable?: boolean;
};

export type ScopeOptionsPage = {
  options: ScopeOption[];
  next_cursor: string | null;
};

export type BrowseScopeInput = {
  parent_id?: string;
  query?: string;
  cursor?: string;
  limit?: number;
};

const scope_options_page_schema: JsonSchema = {
  type: 'object',
  required: ['options'],
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label'],
        properties: {
          id: { type: 'string', minLength: 1 },
          label: { type: 'string' },
          sublabel: { type: ['string', 'number'] },
          preview: { type: 'string' },
          kind: { type: 'string' },
          has_children: { type: 'boolean' },
          selectable: { type: 'boolean' },
        },
      },
    },
    next_cursor: { type: ['string', 'null'] },
  },
};

export function get_sync_dimensions(app_key: string): readonly ConnectorSyncDimension[] {
  return get_connector_app(app_key)?.sync?.dimensions ?? [];
}

export function get_sync_objects(app_key: string): Record<string, ConnectorSyncObject> {
  return get_connector_app(app_key)?.sync?.objects ?? {};
}

export function find_sync_dimension(
  app_key: string,
  dimension_key?: string | undefined,
): ConnectorSyncDimension | null {
  const dimensions = get_sync_dimensions(app_key);
  if (!dimension_key) return dimensions[0] ?? null;
  return dimensions.find((dimension) => dimension.key === dimension_key) ?? null;
}

function find_browse_items(produced: unknown): unknown[] {
  if (!produced || typeof produced !== 'object' || Array.isArray(produced)) return [];
  const record = produced as Record<string, unknown>;
  if (Array.isArray(record.options)) return record.options;
  if (Array.isArray(record.items)) return record.items;
  const arrays = Object.values(record).filter((value): value is unknown[] => Array.isArray(value));
  if (arrays.length === 1) return arrays[0] as unknown[];
  throw new Error(
    'A browse node must answer with one array of items, named `options`, `items`, or the only array in its output.',
  );
}

function find_next_cursor(produced: unknown): string | null {
  if (!produced || typeof produced !== 'object') return null;
  const cursor = (produced as Record<string, unknown>).next_cursor;
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
}

function read_browsing_fields(
  dimension: ConnectorSyncDimension,
  input: BrowseScopeInput,
  browsing: Record<string, unknown>,
): Record<string, unknown> {
  if (!dimension.browse_request) return drop_absent_fields(browsing);
  return evaluate_browse_request(dimension.browse_request, {
    parent_id: input.parent_id,
    query: input.query?.trim() || undefined,
    cursor: input.cursor,
  });
}

function build_browse_node_input(
  dimension: ConnectorSyncDimension,
  input: BrowseScopeInput,
): Record<string, unknown> {
  const { query, ...browsing } = input;
  return {
    ...dimension.browse_input,
    ...read_browsing_fields(dimension, input, browsing),
    ...search_input(dimension, query),
  };
}

export async function browse_scope_options(
  node_key: string,
  input: BrowseScopeInput,
  connection: ConnectorConnection,
  dimension: ConnectorSyncDimension,
): Promise<ConnectorResult<ScopeOptionsPage>> {
  const { query } = input;
  const node_input = build_browse_node_input(dimension, input);
  const result = await execute_node(node_key, node_input, connection);
  if (!result.ok) return result;

  let page: unknown;
  try {
    page = {
      options: narrow_scope_options(shape_scope_options(result.data, dimension), dimension, query),
      next_cursor: find_next_cursor(result.data),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'invalid_output',
        message: `Browsing ${dimension.key} through ${node_key} failed: ${format_error_message(error)}`,
        retryable: false,
      },
    };
  }

  const violation = find_json_schema_violation(scope_options_page_schema, page, 'options');
  if (violation) {
    return {
      ok: false,
      error: {
        code: 'invalid_output',
        message: `${node_key} does not answer in the scope-option shape: ${violation}`,
        retryable: false,
      },
    };
  }
  return { ok: true, data: page as ScopeOptionsPage };
}

function shape_scope_options(produced: unknown, dimension: ConnectorSyncDimension): unknown[] {
  const items = find_browse_items(produced);
  if (!dimension.option_mapping) return items;
  const mapping = dimension.option_mapping;
  return items.map((item) => evaluate_value_expression(mapping, { item }));
}

function search_input(
  dimension: ConnectorSyncDimension,
  query: string | undefined,
): Record<string, unknown> {
  if (!dimension.search_param || !query) return {};
  return { [dimension.search_param]: query };
}

function narrow_scope_options(
  options: unknown[],
  dimension: ConnectorSyncDimension,
  query: string | undefined,
): unknown[] {
  const wanted = query?.trim().toLowerCase();
  if (dimension.search_param || !wanted) return options;
  return options.filter((option) => {
    const label = (option as { label?: unknown } | null)?.label;
    if (typeof label !== 'string') return true;
    return label.toLowerCase().includes(wanted);
  });
}

function drop_absent_fields(input: BrowseScopeInput): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}
