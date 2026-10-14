import type { LookupAddresses } from '@coworker/core/credentials/safe_outbound_url';
import type { McpAuthorizationServer } from '@coworker/core/integrations/mcp_authorization_discovery';
import { validate_mcp_chain_url } from '@coworker/core/integrations/mcp_server_url';
import type { OAuthSetupStrategy } from '@coworker/core/integrations/oauth_setup';
import { ValidationError } from '@coworker/shared';
import { z } from 'zod';

const registration_timeout_ms = 15_000;

const client_registration_response_schema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(),
    client_id_issued_at: z.number().optional(),
    scope: z.string().optional(),
  })
  .loose();

export type McpOAuthClient = {
  client_id: string;
  client_secret: string | null;
  // What this client may actually ask for (RFC 7591 §3.2.1). An authorization
  // server may grant less than it advertises, and Context7 does: it publishes
  // `openid` but refuses a registered client that requests it.
  granted_scopes: string[] | null;
};

export async function register_mcp_oauth_client(input: {
  authorization: McpAuthorizationServer;
  registration_endpoint: string;
  redirect_uri: string;
  client_name: string;
  lookup_addresses: LookupAddresses;
}): Promise<McpOAuthClient> {
  const verdict = await validate_mcp_chain_url({
    url: input.registration_endpoint,
    allowed_hosts: [new URL(input.registration_endpoint).hostname.toLowerCase()],
    lookup_addresses: input.lookup_addresses,
  });
  if (!verdict.accepted) {
    throw new ValidationError(`Refused to register a client: ${verdict.because}`);
  }

  const response = await fetch(verdict.endpoint_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: input.client_name,
      redirect_uris: [input.redirect_uri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: input.authorization.supports_public_client
        ? 'none'
        : 'client_secret_post',
      application_type: 'web',
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(registration_timeout_ms),
  });

  if (!response.ok) {
    const body_preview = await response.text().catch(() => '');
    throw new ValidationError('The authorization server refused to register Alfera as a client.', {
      status: response.status,
      body_preview: body_preview.slice(0, 400),
    });
  }

  const registered = client_registration_response_schema.parse(await response.json());
  return {
    client_id: registered.client_id,
    client_secret: registered.client_secret ?? null,
    granted_scopes: read_granted_scopes(registered.scope),
  };
}

function read_granted_scopes(scope: string | undefined): string[] | null {
  const scopes = scope?.trim().split(/\s+/).filter(Boolean) ?? [];
  return scopes.length > 0 ? scopes : null;
}

export function build_mcp_oauth_setup_strategy(input: {
  authorization: McpAuthorizationServer;
  client_id: string;
  client_secret_env?: string | undefined;
  has_client_secret?: boolean;
  granted_scopes?: string[] | null;
}): OAuthSetupStrategy {
  return {
    type: 'oauth2_authorization_code',
    authorization_url: input.authorization.authorization_endpoint,
    token_url: input.authorization.token_endpoint,
    client_id: input.client_id,
    ...(input.client_secret_env ? { client_secret_env: input.client_secret_env } : {}),
    scopes: generate_requested_scopes(input.granted_scopes ?? input.authorization.scopes_supported),
    use_pkce: true,
    token_auth_method:
      input.authorization.supports_public_client && !input.has_client_secret
        ? 'none'
        : 'client_secret_post',
    authorization_params: { resource: input.authorization.resource },
    resource: input.authorization.resource,
  };
}

// Ask for everything this client is allowed, which is what registration granted
// when it said so and what the server advertises when it did not.
//
// A narrower request sounds safer and is not: MCP servers publish one scope set
// for the whole tool list, and asking for a subset produces a connection whose
// tools fail one at a time at call time, with an authorization error the agent
// cannot fix. The place to restrict what an agent may do is `agent_nodes`, which
// is per tool and reversible, not the token, which is neither.
//
// A server that advertises `offline_access` gets it asked for as part of this,
// which is what buys a refresh token — without one the connection dies silently
// at the first expiry. A server advertising no scopes at all gets none sent,
// which is correct: many MCP servers ignore the parameter entirely.
function generate_requested_scopes(scopes_supported: readonly string[]): string[] {
  return [...new Set(scopes_supported)];
}
