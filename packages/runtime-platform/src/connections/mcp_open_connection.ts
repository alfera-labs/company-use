import type { Database } from '@coworker/core';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import {
  create_workspace_mcp_catalog,
  set_workspace_mcp_app_to_take_no_credential,
} from '@coworker/core/db/queries/mcp_catalog';
import { create_active_mcp_connection } from '@coworker/core/db/queries/mcp_connection';
import type { AppMetadataData } from '@coworker/core/db/schema/json_column_types';
import { mcp_app_takes_a_credential } from '@coworker/core/integrations/mcp_catalog_rows';
import type { McpServerIdentity } from '@coworker/core/integrations/mcp_tool_schema';
import { store_added_mcp_server } from '@runtime-platform/connections/mcp_added_server_store';
import type { McpConnectionOutcome } from '@runtime-platform/connections/mcp_connection_outcome';
import { refuse_credential_or_unreachable } from '@runtime-platform/connections/mcp_server_inspection';
import { read_mcp_tool_listing } from '@runtime-platform/connections/mcp_tool_sync';

type OpenMcpServerInput = {
  db: Database;
  workspace_id: string;
  actor_id: string;
  endpoint_url: string;
  server_key: string;
  display_name?: string | undefined;
  request_headers?: Record<string, string> | undefined;
  added?: { app_id: string; app_display_name: string; metadata: AppMetadataData } | undefined;
};

/**
 * Adds a server that asks for no sign-in: open access, or a key in a header the person gave.
 * The server is asked for its tools with those headers before anything is written, so a server
 * that refuses the key leaves no server and no connection behind. A connection is written even
 * though no credential is wanted: without a row the server never appears in the workspace's
 * connections, so there is nowhere to see it, name it, or disconnect it, and the row is where
 * the header lives, so every later request to the server sends it. All of it is written in one
 * transaction, so an add that fails half way leaves nothing either. A server that was added
 * before and has no active connection is connected again here: when it waited for a token or
 * a sign-in, it is first made to take no credential, so its tools find the new connection.
 */
export async function connect_open_mcp_server(
  input: OpenMcpServerInput,
): Promise<McpConnectionOutcome> {
  const headers = input.request_headers ?? {};
  const given = Object.keys(headers).length > 0 ? 'key_in_a_header' : 'no_key_given';
  const listing = await read_mcp_tool_listing({ endpoint_url: input.endpoint_url, headers }).catch(
    refuse_credential_or_unreachable(given),
  );
  if ('because' in listing) return { kind: 'refused', because: listing.because };

  const identity = listing.session.identity;
  const server_name =
    input.added?.app_display_name ?? input.display_name ?? identity.name ?? input.server_key;
  const stored = await store_added_mcp_server({
    ...input,
    listing,
    save_server_and_connection: (db) =>
      save_open_mcp_server({ ...input, db, server_name, identity }),
  });
  if ('because' in stored) return { kind: 'refused', because: stored.because };

  return { kind: 'connected', ...stored, app_name: server_name };
}

type OpenMcpServerWrites = Omit<OpenMcpServerInput, 'db'> & { db: DatabaseExecutor };

async function save_open_mcp_server(
  input: OpenMcpServerWrites & { server_name: string; identity: McpServerIdentity },
): Promise<string> {
  const app_id = input.added
    ? await reopen_added_mcp_server(input, input.added)
    : await create_open_mcp_server(input);
  await create_active_mcp_connection(input.db, {
    workspace_id: input.workspace_id,
    app_id,
    server_key: input.server_key,
    connection_name: input.server_name,
    ...(input.request_headers ? { request_headers: input.request_headers } : {}),
    actor_id: input.actor_id,
  });
  return app_id;
}

async function reopen_added_mcp_server(
  input: OpenMcpServerWrites,
  app: NonNullable<OpenMcpServerInput['added']>,
): Promise<string> {
  if (mcp_app_takes_a_credential(app)) {
    await set_workspace_mcp_app_to_take_no_credential(input.db, { ...input, app_id: app.app_id });
  }
  return app.app_id;
}

async function create_open_mcp_server(
  input: OpenMcpServerWrites & { server_name: string; identity: McpServerIdentity },
): Promise<string> {
  const catalog = await create_workspace_mcp_catalog(input.db, {
    workspace_id: input.workspace_id,
    server_key: input.server_key,
    server_name: input.server_name,
    named_by_person: Boolean(input.display_name),
    ...(input.identity.icon_url ? { icon_url: input.identity.icon_url } : {}),
    ...(input.identity.description ? { description: input.identity.description } : {}),
    transport_config: { type: 'streamable_http', url: input.endpoint_url },
    tools: [],
    actor_id: input.actor_id,
  });
  return catalog.app_id;
}
