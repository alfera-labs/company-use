import type { Database } from '@coworker/core/db/connection';
import { agents, apps, connections, nodes, tool_calls } from '@coworker/core/db/schema';
import type { ProviderAppUsage } from '@coworker/core/integrations/composio_catalog_plan';
import { and, eq, isNull, sql } from 'drizzle-orm';

function build_connection_usage_query(db: Database, provider_key: string) {
  return db
    .select({
      app_id: connections.app_id,
      connections: sql<number>`count(*)::int`.as('connections'),
      active_connections:
        sql<number>`(count(*) filter (where ${connections.connection_status} = 'active'))::int`.as(
          'active_connections',
        ),
    })
    .from(connections)
    .where(eq(connections.provider_key, provider_key))
    .groupBy(connections.app_id)
    .as('connection_usage');
}

function build_tool_call_usage_query(db: Database, provider_key: string) {
  return db
    .select({
      app_id: nodes.app_id,
      tool_calls: sql<number>`count(*)::int`.as('tool_calls'),
      last_tool_call_time: sql<Date | string | null>`max(${tool_calls.created_time})`.as(
        'last_tool_call_time',
      ),
    })
    .from(tool_calls)
    .innerJoin(
      nodes,
      and(eq(nodes.node_key, tool_calls.tool_name), eq(nodes.provider_key, provider_key)),
    )
    .groupBy(nodes.app_id)
    .as('tool_call_usage');
}

function build_enabled_node_usage_query(db: Database, provider_key: string) {
  return db
    .select({
      app_id: nodes.app_id,
      enabled_node_refs: sql<number>`count(*)::int`.as('enabled_node_refs'),
    })
    .from(nodes)
    .innerJoin(
      agents,
      sql`${agents.agent_config}->'enabled_nodes' @> jsonb_build_array(jsonb_build_object('node_key', ${nodes.node_key}))
        or ${agents.agent_config}->'enabled_nodes' @> to_jsonb(${nodes.node_key})`,
    )
    .where(eq(nodes.provider_key, provider_key))
    .groupBy(nodes.app_id)
    .as('enabled_node_usage');
}

export async function list_provider_app_usage(
  db: Database,
  input: { provider_key: string },
): Promise<ProviderAppUsage[]> {
  const connection_usage = build_connection_usage_query(db, input.provider_key);
  const tool_call_usage = build_tool_call_usage_query(db, input.provider_key);
  const enabled_node_usage = build_enabled_node_usage_query(db, input.provider_key);

  const rows = await db
    .select({
      app_id: apps.app_id,
      app_name: apps.app_name,
      app_display_name: apps.app_display_name,
      provider_app_slug: sql<
        string | null
      >`${apps.metadata}->'sourced_from'->>'provider_app_slug'`.as('provider_app_slug'),
      connections: connection_usage.connections,
      active_connections: connection_usage.active_connections,
      tool_calls: tool_call_usage.tool_calls,
      last_tool_call_time: tool_call_usage.last_tool_call_time,
      enabled_node_refs: enabled_node_usage.enabled_node_refs,
    })
    .from(apps)
    .leftJoin(connection_usage, eq(connection_usage.app_id, apps.app_id))
    .leftJoin(tool_call_usage, eq(tool_call_usage.app_id, apps.app_id))
    .leftJoin(enabled_node_usage, eq(enabled_node_usage.app_id, apps.app_id))
    .where(
      and(
        sql`${apps.metadata}->>'source' = ${input.provider_key}`,
        eq(apps.catalog_scope, 'global'),
        isNull(apps.workspace_id),
      ),
    )
    .orderBy(apps.app_name);

  return rows.map((row) => ({
    app_id: row.app_id,
    app_name: row.app_name,
    app_display_name: row.app_display_name,
    provider_app_slug: row.provider_app_slug,
    connections: row.connections ?? 0,
    active_connections: row.active_connections ?? 0,
    tool_calls: row.tool_calls ?? 0,
    last_tool_call_time: read_iso_time(row.last_tool_call_time),
    enabled_node_refs: row.enabled_node_refs ?? 0,
  }));
}

type CatalogProviderTotals = {
  apps_by_source: Array<{ source: string | null; apps: number }>;
  nodes_by_provider: Array<{ provider_key: string; nodes: number }>;
  connections_by_provider: Array<{
    provider_key: string;
    connection_status: string;
    connections: number;
  }>;
};

export async function read_catalog_provider_totals(db: Database): Promise<CatalogProviderTotals> {
  const apps_by_source = await db
    .select({
      source: sql<string | null>`${apps.metadata}->>'source'`.as('source'),
      apps: sql<number>`count(*)::int`,
    })
    .from(apps)
    .where(and(eq(apps.catalog_scope, 'global'), isNull(apps.workspace_id)))
    .groupBy(sql`${apps.metadata}->>'source'`)
    .orderBy(sql`count(*) desc`);

  const nodes_by_provider = await db
    .select({ provider_key: nodes.provider_key, nodes: sql<number>`count(*)::int` })
    .from(nodes)
    .groupBy(nodes.provider_key)
    .orderBy(sql`count(*) desc`);

  const connections_by_provider = await db
    .select({
      provider_key: connections.provider_key,
      connection_status: connections.connection_status,
      connections: sql<number>`count(*)::int`,
    })
    .from(connections)
    .groupBy(connections.provider_key, connections.connection_status)
    .orderBy(sql`count(*) desc`);

  return { apps_by_source, nodes_by_provider, connections_by_provider };
}

// postgres.js answers a timestamptz as a Date; PGlite can answer a string. Both become one ISO
// string, so the inventory table and the plan see the same value everywhere.
function read_iso_time(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
