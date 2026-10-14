import { apps, connections } from '@coworker/core';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import {
  record_mcp_sync_outcome,
  sync_workspace_mcp_catalog,
} from '@coworker/core/db/queries/mcp_catalog_sync';
import { create_active_mcp_connection } from '@coworker/core/db/queries/mcp_connection';
import { mcp_app_takes_a_credential } from '@coworker/core/integrations/mcp_catalog_rows';
import { create_logger, format_error_message } from '@coworker/shared';
import { read_mcp_tool_list } from '@runtime-platform/tools/mcp/mcp_client';
import { read_mcp_request_headers } from '@runtime-platform/tools/mcp/mcp_credential_headers';
import { open_mcp_session } from '@runtime-platform/tools/mcp/mcp_session';
import { and, eq } from 'drizzle-orm';

const log = create_logger('mcp_tool_sync');

export type McpToolSyncOutcome =
  | { synced: true; app_id: string; tool_count: number; inserted: number; retired: number }
  | { synced: false; because: string };

type SyncInput = {
  db: DatabaseExecutor;
  workspace_id: string;
  app_id: string;
  actor_id: string;
};

export async function sync_mcp_server_tools(input: SyncInput): Promise<McpToolSyncOutcome> {
  const server = await read_mcp_server_record(input.db, input);
  if (!server) return { synced: false, because: 'app_is_not_an_mcp_server' };

  try {
    return await store_listed_mcp_tools(input, server, await read_mcp_tool_listing(server));
  } catch (error) {
    return record_mcp_sync_failure(input, error);
  }
}

export type McpToolListing = Awaited<ReturnType<typeof read_mcp_tool_listing>>;

/** Asks the server for its tools and writes nothing, so an add can be refused with nothing left behind. */
export async function read_mcp_tool_listing(server: {
  endpoint_url: string;
  headers: Record<string, string>;
}) {
  const session = await open_mcp_session(server);
  return { session, tools: await read_mcp_tool_list(session) };
}

/** Stores a tool list the server already gave for an app that was just written. No request is sent. */
export async function store_mcp_tool_listing(
  input: SyncInput,
  listing: McpToolListing,
): Promise<McpToolSyncOutcome> {
  const server = await read_mcp_server_record(input.db, input);
  if (!server) return { synced: false, because: 'app_is_not_an_mcp_server' };
  return store_listed_mcp_tools(input, server, listing);
}

async function store_listed_mcp_tools(
  input: SyncInput,
  server: McpServerRecord,
  { session, tools }: McpToolListing,
): Promise<McpToolSyncOutcome> {
  await create_missing_open_mcp_connection(input, server);

  const result = await sync_workspace_mcp_catalog(input.db, {
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    app_name: server.app_name,
    server_key: server.server_key,
    endpoint_url: server.endpoint_url,
    ...(server.auth_required ? { auth_config: { type: 'mcp_connection' } } : {}),
    tools,
    actor_id: input.actor_id,
    trust_tool_annotations: server.trust_tool_annotations,
  });

  await record_mcp_sync_outcome(input.db, {
    app_id: input.app_id,
    actor_id: input.actor_id,
    tool_list_digest: result.tool_list_digest,
    listed_tool_count: tools.length,
    last_error_message: null,
    identity: session.identity,
  });

  log.info('Synced MCP tools', {
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    listed: tools.length,
    inserted: result.inserted_tool_names.length,
    updated: result.updated_tool_names.length,
    retired: result.retired_node_keys.length,
  });

  return {
    synced: true,
    app_id: input.app_id,
    tool_count: tools.length,
    inserted: result.inserted_tool_names.length,
    retired: result.retired_node_keys.length,
  };
}

async function record_mcp_sync_failure(
  input: SyncInput,
  error: unknown,
): Promise<McpToolSyncOutcome> {
  const because = format_error_message(error);
  await record_mcp_sync_outcome(input.db, {
    app_id: input.app_id,
    actor_id: input.actor_id,
    last_error_message: because,
  });
  log.error('Could not sync MCP tools', {
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    error: because,
  });
  return { synced: false, because };
}

type McpServerRecord = {
  app_name: string;
  app_display_name: string;
  server_key: string;
  endpoint_url: string;
  auth_required: boolean;
  trust_tool_annotations: boolean;
  headers: Record<string, string>;
};

async function create_missing_open_mcp_connection(input: SyncInput, server: McpServerRecord) {
  if (server.auth_required) return;

  const existing = await input.db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.app_id, input.app_id),
      eq(connections.connection_status, 'active'),
    ),
  });
  if (existing) return;

  await create_active_mcp_connection(input.db, {
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    server_key: server.server_key,
    connection_name: server.app_display_name,
    actor_id: input.actor_id,
  });
}

async function read_mcp_server_record(
  db: DatabaseExecutor,
  input: { workspace_id: string; app_id: string },
): Promise<McpServerRecord | null> {
  const app = await db.query.apps.findFirst({
    where: and(eq(apps.app_id, input.app_id), eq(apps.workspace_id, input.workspace_id)),
  });
  if (!app || app.app_category !== 'mcp') return null;

  const provider_config = app.metadata.provider_configs?.find(
    (config) => config.provider_key === 'mcp',
  );
  const endpoint_url = read_endpoint_url(provider_config?.setup_defaults);
  if (!endpoint_url) return null;

  return {
    app_name: app.app_name,
    app_display_name: app.app_display_name,
    server_key: provider_config?.provider_app_key ?? app.app_name,
    endpoint_url,
    auth_required: mcp_app_takes_a_credential(app),
    trust_tool_annotations: app.metadata.mcp_admitted_server === true,
    headers: await read_connection_headers(db, input),
  };
}

function read_endpoint_url(setup_defaults: Record<string, unknown> | undefined): string | null {
  const url = setup_defaults?.url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

async function read_connection_headers(
  db: DatabaseExecutor,
  input: { workspace_id: string; app_id: string },
): Promise<Record<string, string>> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.app_id, input.app_id),
      eq(connections.connection_status, 'active'),
    ),
    orderBy: (table, { desc }) => [desc(table.created_time)],
  });
  return connection ? read_mcp_request_headers(connection.credentials) : {};
}
