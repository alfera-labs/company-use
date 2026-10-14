import type { McpAuthorizationServer } from '@coworker/core/integrations/mcp_authorization_discovery';
import {
  build_mcp_oauth_setup_strategy,
  register_mcp_oauth_client,
} from '@coworker/core/integrations/mcp_client_registration';
import { afterEach, describe, expect, it, vi } from 'vitest';

const advertised = ['openid', 'profile', 'email', 'public_metadata', 'offline_access'];
const granted = 'email offline_access profile';

const authorization: McpAuthorizationServer = {
  authorization_endpoint: 'https://clerk.context7.com/oauth/authorize',
  token_endpoint: 'https://clerk.context7.com/oauth/token',
  registration_endpoint: 'https://clerk.context7.com/oauth/register',
  scopes_supported: advertised,
  supports_public_client: true,
  resource: 'https://mcp.context7.com/mcp',
};

afterEach(() => vi.unstubAllGlobals());

describe('MCP dynamic client registration', () => {
  it('asks only for the scopes registration granted, not the ones advertised', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ client_id: 'lENLUt36ZE8YhARk', scope: granted })),
    );

    const client = await register_mcp_oauth_client({
      authorization,
      registration_endpoint: authorization.registration_endpoint ?? '',
      redirect_uri: 'https://api.example.test/v1/connections/oauth/callback',
      client_name: 'Alfera',
      lookup_addresses: async () => ['93.184.216.34'],
    });

    expect(client.granted_scopes).toEqual(['email', 'offline_access', 'profile']);

    const strategy = build_mcp_oauth_setup_strategy({
      authorization,
      client_id: client.client_id,
      granted_scopes: client.granted_scopes,
    });
    expect(strategy.scopes).not.toContain('openid');
    expect(strategy.scopes).toEqual(['email', 'offline_access', 'profile']);
  });

  it('falls back to the advertised scopes when registration names none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ client_id: 'client_no_scope' })),
    );

    const client = await register_mcp_oauth_client({
      authorization,
      registration_endpoint: authorization.registration_endpoint ?? '',
      redirect_uri: 'https://api.example.test/v1/connections/oauth/callback',
      client_name: 'Alfera',
      lookup_addresses: async () => ['93.184.216.34'],
    });

    expect(client.granted_scopes).toBeNull();
    const strategy = build_mcp_oauth_setup_strategy({
      authorization,
      client_id: client.client_id,
      granted_scopes: client.granted_scopes,
    });
    expect(strategy.scopes).toEqual(advertised);
  });
});
