import { create_app } from '@api/app';
import {
  find_or_mint_mcp_client_key,
  mcp_client_key_name,
  resolve_mcp_client_key,
  verify_mcp_access_token,
} from '@api/lib/mcp_oauth';
import { answer_resource_metadata } from '@api/routes/brain/mcp_oauth_metadata';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  create_api_key,
  list_workspace_api_keys,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { set_last_active_organization } from '@coworker/core/db/queries/workspace_membership';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import {
  type CryptoKey,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const settings = {
  issuer: 'https://auth.test.alfera.ai',
  resource: 'https://api.test.alfera.ai/v1/mcp',
};
const person = { provider_key: 'workos', provider_user_id: 'user_01TESTPERSON' };
const organization_id = 'org_01TESTCOMPANY';
const client_name = 'MCP sign-in';

let db: Database;
let workspace_id: string;
let user_id: string;
let private_key: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  private_key = pair.privateKey;
  const public_jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'test-key' };
  jwks = createLocalJWKSet({ keys: [public_jwk] });
});

beforeEach(async () => {
  db = await create_test_database();
  const provisioned = await provision_workspace_for_identity(db, {
    ...person,
    organization_id,
    email: 'person@test.alfera.ai',
    first_name: 'Test',
    last_name: 'Person',
  });
  workspace_id = provisioned.workspace_id;
  user_id = provisioned.user_id;
});

function sign_token(
  claims: Record<string, unknown>,
  issuer = settings.issuer,
  audience = settings.resource,
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(private_key);
}

function error_code_of(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => (error as { code?: string }).code ?? null,
  );
}

function post_tools_list(db_for_app: Database, url: string, bearer?: string) {
  return create_app(db_for_app).request(url, {
    method: 'POST',
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

describe('MCP OAuth discovery', () => {
  it('tells a client where to sign in', async () => {
    const response = answer_resource_metadata(settings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: 'https://api.test.alfera.ai/v1/mcp',
      authorization_servers: [settings.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: [],
    });
  });

  it('answers 404 when no OAuth server is configured', () => {
    expect(answer_resource_metadata(null).status).toBe(404);
  });

  it('points an unauthenticated MCP call at the resource metadata', async () => {
    const response = await post_tools_list(db, '/v1/mcp');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="${new URL('/.well-known/oauth-protected-resource', env.API_URL).href}"`,
    );
  });

  it('refuses a token while no OAuth server is configured', async () => {
    const token = await sign_token({ sub: person.provider_user_id, org_id: organization_id });
    expect(await error_code_of(resolve_mcp_client_key(db, token, null, jwks))).toBe(
      'oauth_not_configured',
    );
  });
});

describe('a signed-in MCP client', () => {
  it('acts as the person in their workspace, on one key it reuses', async () => {
    const token = await sign_token({ sub: person.provider_user_id, org_id: organization_id });
    const first = await resolve_mcp_client_key(db, token, settings, jwks);
    const second = await resolve_mcp_client_key(db, token, settings, jwks);
    expect(second.api_key_id).toBe(first.api_key_id);
    expect(first.workspace_id).toBe(workspace_id);
    expect(first.key_audience).toBe('internal');
    expect(first.created_by).toBe(user_id);
    expect(first.scopes).toContain('sessions.write');

    const keys = await list_workspace_api_keys(db, workspace_id);
    const named = mcp_client_key_name(user_id, client_name);
    expect(keys.filter((key) => key.key_name === named)).toHaveLength(1);
  });

  it('uses the workspace the person opened last when the token names no organization', async () => {
    const token = await sign_token({ sub: person.provider_user_id });
    expect(await error_code_of(resolve_mcp_client_key(db, token, settings, jwks))).toBe(
      'workspace_not_found',
    );

    await set_last_active_organization(db, { ...person, organization_id });
    const key = await resolve_mcp_client_key(db, token, settings, jwks);
    expect(key.workspace_id).toBe(workspace_id);
  });

  it('refuses a person with no Alfera workspace', async () => {
    const token = await sign_token({ sub: 'user_01NOBODY', org_id: organization_id });
    expect(await error_code_of(resolve_mcp_client_key(db, token, settings, jwks))).toBe(
      'workspace_not_found',
    );
  });

  it('refuses a token from another issuer or with a bad signature', async () => {
    const foreign = await sign_token({ sub: person.provider_user_id }, 'https://someone.example');
    expect(await error_code_of(verify_mcp_access_token(foreign, settings, jwks))).toBe(
      'oauth_token_invalid',
    );
    const for_another_api = await sign_token(
      { sub: person.provider_user_id },
      settings.issuer,
      'https://another-api.example',
    );
    expect(await error_code_of(verify_mcp_access_token(for_another_api, settings, jwks))).toBe(
      'oauth_token_invalid',
    );
    const tampered = `${(await sign_token({ sub: person.provider_user_id })).slice(0, -4)}AAAA`;
    expect(await error_code_of(verify_mcp_access_token(tampered, settings, jwks))).toBe(
      'oauth_token_invalid',
    );
  });

  it('mints a new key after the old one is revoked', async () => {
    const first = await find_or_mint_mcp_client_key(db, { workspace_id, user_id, client_name });
    await revoke_api_key(db, { workspace_id, api_key_id: first.api_key_id, actor_id: user_id });
    const second = await find_or_mint_mcp_client_key(db, { workspace_id, user_id, client_name });
    expect(second.api_key_id).not.toBe(first.api_key_id);
  });

  it('replaces a key that was minted before a scope was added', async () => {
    const { api_key: old_key } = await create_api_key(db, {
      workspace_id,
      key_name: mcp_client_key_name(user_id, client_name),
      scopes: ['memory.read'],
      key_audience: 'internal',
      environment_label: 'live',
      actor_id: user_id,
    });
    const fresh = await find_or_mint_mcp_client_key(db, { workspace_id, user_id, client_name });
    expect(fresh.api_key_id).not.toBe(old_key.api_key_id);
    expect(fresh.scopes).toContain('integrations.read');
    const keys = await list_workspace_api_keys(db, workspace_id);
    expect(keys.find((key) => key.api_key_id === old_key.api_key_id)?.key_status).toBe('revoked');
  });

  it('still takes a plain API key on the MCP route', async () => {
    const response = await post_tools_list(db, '/v1/mcp', 'not-a-jwt-and-not-a-key');
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'api_key_invalid',
    );
  });
});
