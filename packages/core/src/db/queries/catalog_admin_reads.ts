import type { Database } from '@coworker/core/db/connection';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';

export async function count_global_apps_by_source_provider(db: Database) {
  const provider = sql<string | null>`${apps.metadata}->'sourced_from'->>'provider'`;
  const rows = await db
    .select({ provider, app_count: sql<number>`count(*)::int` })
    .from(apps)
    .where(and(eq(apps.catalog_scope, 'global'), isNull(apps.workspace_id)))
    .groupBy(provider);
  return new Map(rows.map((row) => [row.provider ?? 'unset', Number(row.app_count)]));
}

export async function read_recipe_catalog_rows(db: Database, node_keys: readonly string[]) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SET TRANSACTION READ ONLY`);
    const node_rows = await transaction
      .select({
        node_key: nodes.node_key,
        app_id: nodes.app_id,
        node_status: nodes.node_status,
        successor_node_key: nodes.successor_node_key,
        runtime_handler: nodes.runtime_handler,
        input_schema: nodes.input_schema,
        output_schema: nodes.output_schema,
      })
      .from(nodes)
      .where(inArray(nodes.node_key, [...node_keys]));
    const app_ids = [...new Set(node_rows.map((row) => row.app_id))];
    const connection_counts = await transaction
      .select({
        app_id: connections.app_id,
        connection_status: connections.connection_status,
        provider_key: connections.provider_key,
        connection_count: count(),
      })
      .from(connections)
      .where(inArray(connections.app_id, app_ids))
      .groupBy(connections.app_id, connections.connection_status, connections.provider_key);
    return { node_rows, connection_counts };
  });
}

export async function list_active_provider_connections(
  db: Database,
  input: { provider_key: string; app_keys: readonly string[] },
) {
  return db
    .select({
      workspace_id: connections.workspace_id,
      connection_id: connections.connection_id,
      app_key: apps.app_key,
      connection_status: connections.connection_status,
      provider_account: connections.provider_account,
      external_user_key: connections.external_user_key,
    })
    .from(connections)
    .innerJoin(apps, eq(apps.app_id, connections.app_id))
    .where(
      and(
        eq(connections.provider_key, input.provider_key),
        eq(connections.connection_status, 'active'),
        inArray(apps.app_key, [...input.app_keys]),
      ),
    );
}
