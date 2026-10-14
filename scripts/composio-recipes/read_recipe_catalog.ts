import { close_database, get_database } from '@coworker/core/db/connection';
import { read_recipe_catalog_rows } from '@coworker/core/db/queries/catalog_admin_reads';

export type CatalogNodeRow = {
  node_key: string;
  app_id: string;
  node_status: string;
  successor_node_key: string | null;
  runtime_handler: string;
  input_schema: unknown;
  output_schema: unknown;
};

export type ConnectionCountRow = {
  app_id: string;
  connection_status: string;
  provider_key: string;
  connection_count: number;
};

function pick_active_rows(rows: readonly CatalogNodeRow[]): Map<string, CatalogNodeRow> {
  const by_key = new Map<string, CatalogNodeRow>();
  for (const row of rows) {
    if (by_key.get(row.node_key)?.node_status === 'active') continue;
    by_key.set(row.node_key, row);
  }
  return by_key;
}

export async function read_recipe_catalog(node_keys: readonly string[]) {
  const result = await read_recipe_catalog_rows(get_database(), node_keys);
  await close_database();
  return { nodes_by_key: pick_active_rows(result.node_rows), connection_counts: result.connection_counts };
}
