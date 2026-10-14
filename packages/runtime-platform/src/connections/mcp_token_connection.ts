import type { Database } from '@coworker/core';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import {
  create_workspace_mcp_catalog,
  find_workspace_mcp_app,
} from '@coworker/core/db/queries/mcp_catalog';
import { create_active_mcp_connection } from '@coworker/core/db/queries/mcp_connection';
import { mcp_app_takes_a_credential } from '@coworker/core/integrations/mcp_catalog_rows';
import type { McpServerIdentity } from '@coworker/core/integrations/mcp_tool_schema';
import { store_added_mcp_server } from '@runtime-platform/connections/mcp_added_server_store';
import type { McpConnectionOutcome } from '@runtime-platform/connections/mcp_connection_outcome';
import { refuse_credential_or_unreachable } from '@runtime-platform/connections/mcp_server_inspection';
import { read_mcp_tool_listing } from '@runtime-platform/connections/mcp_tool_sync';

/**
 * Adds a server with a token the person pasted. The server is asked for its tools with the
 * token before anything is written, so a refused token leaves nothing behind, and the writes run
 * in one transaction, so an add that fails half way leaves nothing either. A server that was
 * first added with no credential keeps tools that look for an open connection, and a token
 * connection would never match them: there the token is stored as the Authorization header of
 * an open connection, which those tools do find.
 */
export async function connect_mcp_server_with_token(input: {
  db: Database;
  workspace_id: string;
  actor_id: string;
  endpoint_url: string;
  server_key: string;
  access_token: string;
  display_name?: string | undefined;
}): Promise<McpConnectionOutcome> {
  const headers = { Authorization: `Bearer ${input.access_token}` };
  const listing = await read_mcp_tool_listing({ endpoint_url: input.endpoint_url, headers }).catch(
    refuse_credential_or_unreachable('key_as_a_token'),
  );
  if ('because' in listing) return { kind: 'refused', because: listing.because };

  const identity = listing.session.identity;
  const app_name = input.display_name ?? identity.name ?? input.server_key;

  const existing = await find_workspace_mcp_app(input.db, {
    workspace_id: input.workspace_id,
    server_key: input.server_key,
  });
  const credential =
    existing && !mcp_app_takes_a_credential(existing)
      ? { request_headers: headers }
      : { access_token: input.access_token };

  const stored = await store_added_mcp_server({
    ...input,
    listing,
    save_server_and_connection: async (db) => {
      const app_id =
        existing?.app_id ??
        (await create_token_mcp_catalog({ ...input, db, app_name, identity })).app_id;
      await create_active_mcp_connection(db, {
        workspace_id: input.workspace_id,
        app_id,
        server_key: input.server_key,
        ...credential,
        connection_name: app_name,
        actor_id: input.actor_id,
      });
      return app_id;
    },
  });
  if ('because' in stored) return { kind: 'refused', because: stored.because };

  return { kind: 'connected', ...stored, app_name };
}

async function create_token_mcp_catalog(input: {
  db: DatabaseExecutor;
  workspace_id: string;
  actor_id: string;
  endpoint_url: string;
  server_key: string;
  app_name: string;
  display_name?: string | undefined;
  identity: McpServerIdentity;
}) {
  return create_workspace_mcp_catalog(input.db, {
    workspace_id: input.workspace_id,
    server_key: input.server_key,
    server_name: input.app_name,
    named_by_person: Boolean(input.display_name),
    ...(input.identity.icon_url ? { icon_url: input.identity.icon_url } : {}),
    ...(input.identity.description ? { description: input.identity.description } : {}),
    transport_config: { type: 'streamable_http', url: input.endpoint_url },
    auth_config: { type: 'mcp_connection' },
    tools: [],
    actor_id: input.actor_id,
  });
}
