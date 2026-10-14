import { env } from '@coworker/config';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKey,
  type ApiKeyScope,
  create_api_key,
  find_live_api_key_by_name,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { read_last_active_organization } from '@coworker/core/db/queries/workspace_membership';
import { find_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { AppError, keep_offered_scopes } from '@coworker/shared';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

const identity_provider_key = 'workos';

export const mcp_client_scopes: readonly ApiKeyScope[] = keep_offered_scopes<ApiKeyScope>([
  'answers.write',
  'memory.read',
  'memory.write',
  'agents.read',
  'agents.write',
  'sessions.read',
  'sessions.write',
  'projects.read',
  'automations.read',
  'automations.write',
  'skills.read',
  'usage.read',
  'integrations.read',
]);

export type McpAccessTokenClaims = { sub: string; org_id: string | null };

export type McpOauthSettings = { issuer: string; resource: string };

export function read_mcp_oauth_settings(): McpOauthSettings | null {
  if (!env.MCP_OAUTH_ISSUER) return null;
  return {
    issuer: env.MCP_OAUTH_ISSUER.replace(/\/$/u, ''),
    resource: new URL('/v1/mcp', env.API_PUBLIC_URL ?? env.API_URL).href,
  };
}

export function looks_like_jwt(presented: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(presented);
}

let remote_key_set: { issuer: string; get_key: JWTVerifyGetKey } | null = null;

function key_set_for(issuer: string): JWTVerifyGetKey {
  if (remote_key_set?.issuer !== issuer) {
    remote_key_set = { issuer, get_key: createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`)) };
  }
  return remote_key_set.get_key;
}

export async function verify_mcp_access_token(
  token: string,
  settings: McpOauthSettings,
  get_key: JWTVerifyGetKey = key_set_for(settings.issuer),
): Promise<McpAccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, get_key, {
      issuer: settings.issuer,
      audience: settings.resource,
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new AppError('oauth_token_invalid', 'The access token names no user', 401);
    }
    const org_id = payload.org_id;
    return { sub: payload.sub, org_id: typeof org_id === 'string' && org_id ? org_id : null };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('oauth_token_invalid', 'The access token is not valid', 401);
  }
}

/** The workspace this person acts in: the organization on the token, else the one opened last. */
export async function find_mcp_client_workspace(db: Database, claims: McpAccessTokenClaims) {
  const identity = { provider_key: identity_provider_key, provider_user_id: claims.sub };
  const organization_id = claims.org_id ?? (await read_last_active_organization(db, identity));
  if (!organization_id) {
    throw new AppError(
      'workspace_not_found',
      'Sign in to Alfera and open a workspace first, then connect again',
      403,
    );
  }
  const actor = await find_workspace_for_identity(db, { ...identity, organization_id });
  if (!actor) {
    throw new AppError(
      'workspace_not_found',
      `No active Alfera workspace for this account. Sign up at ${new URL(env.NEXT_PUBLIC_APP_URL).host} first.`,
      403,
    );
  }
  return actor;
}

export function mcp_client_key_name(user_id: string, client_name: string): string {
  return `${client_name}:${user_id}`;
}

/**
 * One live key per person per client, minted on first connect and reused after. Revoking it on
 * the API keys page disconnects the client. A key minted before a scope was added is replaced.
 */
export async function find_or_mint_mcp_client_key(
  db: Database,
  input: { workspace_id: string; user_id: string; client_name: string },
): Promise<ApiKey> {
  const key_name = mcp_client_key_name(input.user_id, input.client_name);
  const existing = await find_live_api_key_by_name(db, {
    workspace_id: input.workspace_id,
    key_name,
  });
  if (existing && mcp_client_scopes.every((scope) => existing.scopes.includes(scope))) {
    return existing;
  }
  if (existing) {
    await revoke_api_key(db, {
      workspace_id: input.workspace_id,
      api_key_id: existing.api_key_id,
      actor_id: input.user_id,
    });
  }
  const { api_key } = await create_api_key(db, {
    workspace_id: input.workspace_id,
    key_name,
    scopes: [...mcp_client_scopes],
    key_audience: 'internal',
    environment_label: 'live',
    actor_id: input.user_id,
  });
  return api_key;
}

export async function resolve_mcp_client_key(
  db: Database,
  token: string,
  settings: McpOauthSettings | null,
  get_key?: JWTVerifyGetKey,
): Promise<ApiKey> {
  if (!settings) {
    throw new AppError('oauth_not_configured', 'This MCP endpoint takes API keys only', 401);
  }
  const claims = await verify_mcp_access_token(token, settings, get_key);
  const actor = await find_mcp_client_workspace(db, claims);
  return find_or_mint_mcp_client_key(db, {
    workspace_id: actor.workspace_id,
    user_id: actor.user_id,
    client_name: 'MCP sign-in',
  });
}
