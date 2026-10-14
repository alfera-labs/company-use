import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { resolve_host_addresses } from '@coworker/core/credentials/resolve_host_addresses';
import { create_pending_connection_setup } from '@coworker/core/db/queries/connection_management';
import { create_workspace_mcp_catalog } from '@coworker/core/db/queries/mcp_catalog';
import {
  discover_mcp_authorization,
  type McpAuthorizationServer,
} from '@coworker/core/integrations/mcp_authorization_discovery';
import {
  build_mcp_oauth_setup_strategy,
  register_mcp_oauth_client,
} from '@coworker/core/integrations/mcp_client_registration';
import type { McpServerIdentity } from '@coworker/core/integrations/mcp_tool_schema';
import type { WorkspaceOAuthClient } from '@coworker/core/integrations/oauth_setup';
import { create_logger, ValidationError } from '@coworker/shared';
import type { ConnectionResumeSetup } from '@runtime-platform/connections/connection_resume_intent';
import { build_connection_start_url } from '@runtime-platform/connections/connection_start_link';
import { resolve_provider_oauth_redirect_uri } from '@runtime-platform/connections/oauth_connection_setup';

const log = create_logger('mcp_authorization_setup');

export type McpAuthorizationStarted = {
  app_id: string;
  app_key: string;
  app_name: string;
  icon_url?: string | undefined;
  connection_id: string;
  start_url: string;
};

export async function begin_mcp_authorization(
  input: {
    db: Database;
    workspace_id: string;
    actor_id: string;
    endpoint_url: string;
    server_key: string;
    www_authenticate: string | null;
    identity?: McpServerIdentity | null;
    display_name?: string | undefined;
    redirect_uri: string;
    oauth_client?: WorkspaceOAuthClient | undefined;
    request_headers?: Record<string, string> | undefined;
  } & ConnectionResumeSetup,
): Promise<McpAuthorizationStarted> {
  const authorization = await discover_mcp_authorization({
    endpoint_url: input.endpoint_url,
    www_authenticate: input.www_authenticate,
    lookup_addresses: resolve_host_addresses,
  });
  const client = await resolve_mcp_oauth_client({
    authorization,
    server_key: input.server_key,
    redirect_uri: resolve_provider_oauth_redirect_uri(),
    ...(input.oauth_client ? { oauth_client: input.oauth_client } : {}),
  });
  const catalog = await create_mcp_oauth_catalog({ ...input, authorization, client });
  log.info('MCP server awaiting authorization', {
    workspace_id: input.workspace_id,
    app_id: catalog.app_id,
    server_key: input.server_key,
  });

  return start_mcp_connection_setup({
    ...input,
    ...(client.client_secret ? { oauth_client_secret: client.client_secret } : {}),
    app_id: catalog.app_id,
    app_key: catalog.app_name,
    app_name: input.display_name ?? input.identity?.name ?? input.server_key,
    ...(input.identity?.icon_url ? { icon_url: input.identity.icon_url } : {}),
  });
}

export async function start_mcp_connection_setup(
  input: {
    db: Database;
    workspace_id: string;
    actor_id: string;
    app_id: string;
    app_key: string;
    app_name: string;
    icon_url?: string | undefined;
    redirect_uri: string;
    oauth_client_secret?: string | undefined;
    request_headers?: Record<string, string> | undefined;
  } & ConnectionResumeSetup,
): Promise<McpAuthorizationStarted> {
  const pending = await create_pending_connection_setup(input.db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    app_id: input.app_id,
    redirect_uri: input.redirect_uri,
    ...(input.oauth_client_secret ? { oauth_client_secret: input.oauth_client_secret } : {}),
    ...(input.request_headers ? { request_headers: input.request_headers } : {}),
    ...(input.setup_session_id ? { setup_session_id: input.setup_session_id } : {}),
    ...(input.resume ? { resume: input.resume } : {}),
  });
  const start_url = build_connection_start_url({
    connection_id: pending.connection.connection_id,
    setup_token: pending.setup.setup_token,
  });
  if (!start_url) {
    throw new ValidationError('Connection setup produced no start link.', {
      connection_id: pending.connection.connection_id,
    });
  }

  return {
    app_id: input.app_id,
    app_key: input.app_key,
    app_name: input.app_name,
    ...(input.icon_url ? { icon_url: input.icon_url } : {}),
    connection_id: pending.connection.connection_id,
    start_url,
  };
}

async function create_mcp_oauth_catalog(input: {
  db: Database;
  workspace_id: string;
  actor_id: string;
  endpoint_url: string;
  server_key: string;
  display_name?: string | undefined;
  identity?: McpServerIdentity | null;
  authorization: McpAuthorizationServer;
  client: ResolvedMcpOAuthClient;
}) {
  const client = input.client;

  return create_workspace_mcp_catalog(input.db, {
    workspace_id: input.workspace_id,
    server_key: input.server_key,
    server_name: input.display_name ?? input.identity?.name ?? input.server_key,
    named_by_person: Boolean(input.display_name),
    ...(input.identity?.icon_url ? { icon_url: input.identity.icon_url } : {}),
    ...(input.identity?.description ? { description: input.identity.description } : {}),
    transport_config: { type: 'streamable_http', url: input.endpoint_url },
    auth_config: { type: 'mcp_connection' },
    setup_strategy: build_mcp_oauth_setup_strategy({
      authorization: input.authorization,
      client_id: client.client_id,
      has_client_secret: Boolean(client.client_secret),
      granted_scopes: client.granted_scopes,
    }),
    tools: [],
    actor_id: input.actor_id,
  });
}

type ResolvedMcpOAuthClient = {
  client_id: string;
  client_secret: string | null;
  granted_scopes: string[] | null;
};

async function resolve_mcp_oauth_client(input: {
  authorization: McpAuthorizationServer;
  server_key: string;
  redirect_uri: string;
  oauth_client?: WorkspaceOAuthClient | undefined;
}): Promise<ResolvedMcpOAuthClient> {
  if (input.oauth_client) {
    return {
      client_id: input.oauth_client.client_id,
      client_secret: input.oauth_client.client_secret ?? null,
      granted_scopes: null,
    };
  }

  if (input.authorization.registration_endpoint) {
    return register_mcp_oauth_client({
      authorization: input.authorization,
      registration_endpoint: input.authorization.registration_endpoint,
      redirect_uri: input.redirect_uri,
      client_name: 'Alfera',
      lookup_addresses: resolve_host_addresses,
    });
  }

  const configured = env.COWORKER_MCP_OAUTH_CLIENT_IDS?.[input.server_key];
  if (configured) return { client_id: configured, client_secret: null, granted_scopes: null };

  throw new ValidationError(
    `${input.server_key} does not support automatic client registration, so it needs a client id configured before it can be connected.`,
    { server_key: input.server_key },
  );
}
