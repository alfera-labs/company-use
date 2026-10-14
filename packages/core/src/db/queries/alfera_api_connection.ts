import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { set_policies } from '@coworker/core/db/queries/policies';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import {
  alfera_api_app_name,
  alfera_api_connection_key,
  alfera_api_display_name,
  alfera_api_tool_policy_labels,
  alfera_api_tools,
  build_alfera_api_node_key,
  build_alfera_api_tool_group,
  built_in_connection_status,
  settings_only_discovery_status,
} from '@coworker/core/integrations/alfera_api_tools';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, isNull } from 'drizzle-orm';

const actor_id = 'system:alfera_api';
const provider_config_key = `native:${alfera_api_app_name}`;

export type AlferaApiConnection = typeof connections.$inferSelect;

export async function register_alfera_api_catalog(db: Database) {
  const app = (await find_alfera_api_app(db)) ?? (await create_alfera_api_app(db));
  for (const tool of alfera_api_tools) {
    const values = build_alfera_api_node_values(app.app_id, tool);
    await db
      .insert(nodes)
      .values({ node_id: create_id(id_prefixes.node), ...values, created_by: actor_id })
      .onConflictDoUpdate({
        target: [nodes.app_id, nodes.node_name],
        set: { ...values, last_updated_time: new Date() },
      });
  }
  return app;
}

export async function find_or_create_alfera_api_connection(
  db: Database,
  workspace_id: string,
): Promise<AlferaApiConnection> {
  const existing = await find_alfera_api_connection(db, workspace_id);
  if (existing) return existing;
  const app = (await find_alfera_api_app(db)) ?? (await register_alfera_api_catalog(db));
  return create_alfera_api_connection(db, { workspace_id, app_id: app.app_id });
}

async function create_alfera_api_connection(
  db: Database,
  input: { workspace_id: string; app_id: string },
) {
  return db.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(connections)
      .values(build_alfera_api_connection_values(input))
      .onConflictDoNothing({ target: [connections.workspace_id, connections.connection_key] })
      .returning();
    if (!created) return read_alfera_api_connection(transaction, input.workspace_id);

    await set_policies(transaction, {
      workspace_id: input.workspace_id,
      scope_type: 'connection',
      scope_id: created.connection_id,
      policies: alfera_api_tools
        .filter((tool) => tool.asks_by_default)
        .map((tool) => ({
          resource_type: 'node',
          resource_id: build_alfera_api_node_key(tool.tool_name),
          policy_mode: 'ask' as const,
        })),
      actor_id,
    });
    return created;
  });
}

async function find_alfera_api_connection(db: DatabaseExecutor, workspace_id: string) {
  return (
    (await db.query.connections.findFirst({
      where: and(
        eq(connections.workspace_id, workspace_id),
        eq(connections.connection_key, alfera_api_connection_key),
      ),
    })) ?? null
  );
}

async function read_alfera_api_connection(db: DatabaseExecutor, workspace_id: string) {
  const connection = await find_alfera_api_connection(db, workspace_id);
  if (!connection) throw new Error(`Alfera API connection missing after insert: ${workspace_id}`);
  return connection;
}

function find_alfera_api_app(db: Database) {
  return db.query.apps.findFirst({
    where: and(
      eq(apps.app_name, alfera_api_app_name),
      eq(apps.catalog_scope, 'global'),
      isNull(apps.workspace_id),
    ),
  });
}

async function create_alfera_api_app(db: Database) {
  await db
    .insert(apps)
    .values({
      app_id: create_id(id_prefixes.app),
      app_name: alfera_api_app_name,
      app_key: alfera_api_app_name,
      catalog_scope: 'global',
      app_display_name: alfera_api_display_name,
      app_category: 'internal',
      auth_type: 'none',
      app_status: 'active',
      display_config: {},
      metadata: {
        sourced_from: { provider: 'native', provider_app_id: provider_config_key },
        description: "This workspace's own API and MCP tools. Built in; nothing to connect.",
      },
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoNothing();
  const app = await find_alfera_api_app(db);
  if (!app) throw new Error('Alfera API app missing after insert');
  return app;
}

function build_alfera_api_connection_values(input: { workspace_id: string; app_id: string }) {
  return {
    connection_id: create_id(id_prefixes.connection),
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    connection_key: alfera_api_connection_key,
    connection_name: alfera_api_display_name,
    connection_status: built_in_connection_status,
    provider_key: 'native',
    provider_config_key,
    connected_by: actor_id,
    connected_time: new Date(),
    created_by: actor_id,
    last_updated_by: actor_id,
  };
}

function build_alfera_api_node_values(app_id: string, tool: (typeof alfera_api_tools)[number]) {
  return {
    app_id,
    app_key: alfera_api_app_name,
    node_name: tool.tool_name,
    catalog_scope: 'global',
    node_key: build_alfera_api_node_key(tool.tool_name),
    node_version: 1,
    node_display_name: tool.display_name,
    node_kind: 'tool',
    input_schema: { type: 'object' as const, properties: {} },
    runtime_handler: `${alfera_api_app_name}.${tool.tool_name}`,
    node_runtime: 'native_tool',
    node_status: 'active',
    discovery_status: settings_only_discovery_status,
    provider_key: 'native',
    provider_config_key,
    provider_config_version: 1,
    node_config: {
      sourced_from: {
        provider: 'native',
        provider_app_id: provider_config_key,
        provider_component_id: tool.tool_name,
        provider_component_version: '1',
      },
    },
    metadata: {
      source: 'alfera_api',
      description: tool.description,
      policy_labels: alfera_api_tool_policy_labels(tool),
      tool_group: build_alfera_api_tool_group(tool.group_key),
    },
    last_updated_by: actor_id,
  };
}
