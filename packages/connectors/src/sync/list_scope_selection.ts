import { ConnectorHttpError } from '@connectors/runtime/http_request';
import { browse_scope_options, type ScopeOption } from '@connectors/sync_scope';
import type { ConnectorSyncDimension } from '@connectors/sync_types';
import type { ConnectorConnection } from '@connectors/types';

export type ScopeSelectionRow = {
  id: string;
  label: string;
  kind?: string;
  has_children?: boolean;
  selectable?: boolean;
};

const select_all_page_limit = 10;

function to_selection_row(option: ScopeOption): ScopeSelectionRow {
  return {
    id: option.id,
    label: option.label,
    ...(option.kind !== undefined ? { kind: option.kind } : {}),
    ...(option.has_children !== undefined ? { has_children: option.has_children } : {}),
    ...(option.selectable !== undefined ? { selectable: option.selectable } : {}),
  };
}

async function list_selection_page(
  connection: ConnectorConnection,
  dimension: ConnectorSyncDimension,
  browse_node: string,
  cursor: string | undefined,
  pages_remaining: number,
): Promise<readonly ScopeSelectionRow[]> {
  const result = await browse_scope_options(
    browse_node,
    cursor ? { cursor } : {},
    connection,
    dimension,
  );
  if (!result.ok) {
    throw new ConnectorHttpError(
      result.error.code,
      `Listing every ${dimension.key} failed: ${result.error.message}`,
      null,
      result.error.retryable,
    );
  }
  const rows = result.data.options.map(to_selection_row);
  const next_cursor = result.data.next_cursor;
  if (!next_cursor || pages_remaining <= 1) return rows;
  const rest = await list_selection_page(
    connection,
    dimension,
    browse_node,
    next_cursor,
    pages_remaining - 1,
  );
  return [...rows, ...rest];
}

export function list_scope_selection(
  connection: ConnectorConnection,
  dimension: ConnectorSyncDimension,
): Promise<readonly ScopeSelectionRow[]> {
  if (!dimension.browse_node) return Promise.resolve([]);
  return list_selection_page(
    connection,
    dimension,
    dimension.browse_node,
    undefined,
    select_all_page_limit,
  );
}
