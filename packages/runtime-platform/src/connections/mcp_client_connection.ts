import type { Database } from '@coworker/core';
import {
  find_workspace_mcp_app,
  set_workspace_mcp_oauth_client,
} from '@coworker/core/db/queries/mcp_catalog';
import { find_active_mcp_connection } from '@coworker/core/db/queries/mcp_connection';
import { mcp_app_takes_a_credential } from '@coworker/core/integrations/mcp_catalog_rows';
import type { WorkspaceOAuthClient } from '@coworker/core/integrations/oauth_setup';
import { find_mcp_request_header_refusal } from '@coworker/shared';
import type { ConnectionResumeSetup } from '@runtime-platform/connections/connection_resume_intent';
import { probe_mcp_authorization } from '@runtime-platform/connections/mcp_authorization_probe';
import {
  begin_mcp_authorization,
  start_mcp_connection_setup,
} from '@runtime-platform/connections/mcp_authorization_setup';
import type { McpConnectionOutcome } from '@runtime-platform/connections/mcp_connection_outcome';
import {
  admit_mcp_server_url,
  headers_for_the_server,
} from '@runtime-platform/connections/mcp_endpoint_admission';
import { connect_open_mcp_server } from '@runtime-platform/connections/mcp_open_connection';
import type { McpServerAsker } from '@runtime-platform/connections/mcp_private_server_rule';
import type { McpAuthenticationMode } from '@runtime-platform/connections/mcp_server_inspection';
import { refuse_unreachable } from '@runtime-platform/connections/mcp_server_inspection';
import { pick_mcp_server_key } from '@runtime-platform/connections/mcp_server_key_choice';
import { connect_mcp_server_with_token } from '@runtime-platform/connections/mcp_token_connection';
import { sync_mcp_server_tools } from '@runtime-platform/connections/mcp_tool_sync';

type McpServerAddition = {
  db: Database;
  workspace_id: string;
  actor_id: string;
  server_url: string;
  display_name?: string | undefined;
  access_token?: string | undefined;
  oauth_client?: WorkspaceOAuthClient | undefined;
  authentication?: McpAuthenticationMode | undefined;
  request_headers?: Record<string, string> | undefined;
  redirect_uri: string;
  asked_by?: McpServerAsker | undefined;
} & ConnectionResumeSetup;

type AdmittedMcpServerAddition = McpServerAddition & { endpoint_url: string; server_key: string };

/**
 * Adds an MCP server to a workspace, or connects one that was added before. A server that is
 * connected keeps the kind of credential it has. A server nobody is connected to takes the
 * kind this add gives, so a server once added with a token can be added again with a key in a
 * header, and the other way round.
 */
export async function define_mcp_client_connection(
  input: McpServerAddition,
): Promise<McpConnectionOutcome> {
  const header_refusal = find_mcp_request_header_refusal(Object.keys(input.request_headers ?? {}));
  if (header_refusal) return { kind: 'refused', because: header_refusal };

  const admitted = await admit_mcp_server_url({
    server_url: input.server_url,
    headers: headers_for_the_server(input),
    asked_by: input.asked_by,
  });
  if (!admitted.accepted) return { kind: 'refused', because: admitted.because };

  const server_key = await pick_mcp_server_key(input.db, input.workspace_id, admitted.endpoint_url);
  const addition = { ...input, endpoint_url: admitted.endpoint_url, server_key };

  const access_token = input.access_token?.trim();
  if (access_token) return connect_mcp_server_with_token({ ...addition, access_token });

  const already_added = await find_workspace_mcp_app(input.db, {
    workspace_id: input.workspace_id,
    server_key,
  });
  if (!already_added) return connect_new_mcp_server(addition);
  return connect_added_mcp_server(addition, already_added);
}

async function connect_new_mcp_server(
  input: AdmittedMcpServerAddition,
): Promise<McpConnectionOutcome> {
  const challenge = await probe_mcp_authorization(input.endpoint_url).catch(refuse_unreachable);
  if ('because' in challenge) return { kind: 'refused', because: challenge.because };
  const detected = challenge.kind === 'open' ? 'none' : challenge.when;

  if ((input.authentication ?? detected) === 'none') return connect_open_mcp_server(input);

  const started = await begin_mcp_authorization({
    ...input,
    www_authenticate: challenge.kind === 'open' ? null : challenge.www_authenticate,
    identity: challenge.identity,
  });
  return { kind: 'needs_authorization', ...started };
}

async function connect_added_mcp_server(
  input: AdmittedMcpServerAddition,
  app: AddedMcpApp,
): Promise<McpConnectionOutcome> {
  const app_name = app.app_display_name;
  if (await find_active_mcp_connection(input.db, { ...input, app_id: app.app_id })) {
    return {
      kind: 'refused',
      because: `${app_name} is already connected. Remove that connection first, then add the server again.`,
    };
  }
  if (input.authentication === 'none') return connect_open_mcp_server({ ...input, added: app });
  return resume_added_mcp_server({ ...input, app });
}

type AddedMcpApp = NonNullable<Awaited<ReturnType<typeof find_workspace_mcp_app>>>;

async function resume_added_mcp_server(
  input: {
    db: Database;
    workspace_id: string;
    actor_id: string;
    redirect_uri: string;
    oauth_client?: WorkspaceOAuthClient | undefined;
    request_headers?: Record<string, string> | undefined;
    app: AddedMcpApp;
  } & ConnectionResumeSetup,
): Promise<McpConnectionOutcome> {
  const app_name = input.app.app_display_name;
  if (!mcp_app_takes_a_credential(input.app)) {
    const synced = await sync_mcp_server_tools({
      db: input.db,
      workspace_id: input.workspace_id,
      app_id: input.app.app_id,
      actor_id: input.actor_id,
    });
    if (!synced.synced) return { kind: 'refused', because: synced.because };
    return {
      kind: 'connected',
      app_id: input.app.app_id,
      app_name,
      tool_count: synced.tool_count,
    };
  }

  if (input.oauth_client) {
    await set_workspace_mcp_oauth_client(input.db, {
      ...input,
      app_id: input.app.app_id,
      client_id: input.oauth_client.client_id,
      has_client_secret: Boolean(input.oauth_client.client_secret),
    });
  }

  const started = await start_mcp_connection_setup({
    db: input.db,
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    app_id: input.app.app_id,
    app_key: input.app.app_name,
    app_name,
    ...(input.app.metadata.icon_url ? { icon_url: input.app.metadata.icon_url } : {}),
    redirect_uri: input.redirect_uri,
    ...(input.oauth_client?.client_secret
      ? { oauth_client_secret: input.oauth_client.client_secret }
      : {}),
    ...(input.request_headers ? { request_headers: input.request_headers } : {}),
    ...(input.setup_session_id ? { setup_session_id: input.setup_session_id } : {}),
    ...(input.resume ? { resume: input.resume } : {}),
  });
  return { kind: 'needs_authorization', ...started };
}
