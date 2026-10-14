import { discover_mcp_authorization } from '@coworker/core/integrations/mcp_authorization_discovery';
import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup_addresses = async () => ['93.184.216.34'];

const authorization_server_metadata = {
  issuer: 'https://brain.example.test',
  authorization_endpoint: 'https://brain.example.test/oauth/authorize',
  token_endpoint: 'https://brain.example.test/oauth/token',
  registration_endpoint: 'https://brain.example.test/oauth/register',
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['read', 'write'],
};

afterEach(() => vi.unstubAllGlobals());

function stub_fetch(metadata: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url).includes('oauth-authorization-server')) return Response.json(metadata);
      return new Response('', { status: 404 });
    }),
  );
}

describe('MCP authorization discovery', () => {
  it('treats a server with no protected-resource document as its own authorization server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href.includes('oauth-protected-resource')) return new Response('', { status: 404 });
        if (href.includes('oauth-authorization-server')) {
          return Response.json(authorization_server_metadata);
        }
        return new Response('', { status: 404 });
      }),
    );

    const authorization = await discover_mcp_authorization({
      endpoint_url: 'https://brain.example.test/mcp',
      www_authenticate: null,
      lookup_addresses,
    });

    expect(authorization.authorization_endpoint).toBe('https://brain.example.test/oauth/authorize');
    expect(authorization.token_endpoint).toBe('https://brain.example.test/oauth/token');
    expect(authorization.registration_endpoint).toBe('https://brain.example.test/oauth/register');
    expect(authorization.resource).toBe('https://brain.example.test/mcp');
  });

  it.each([
    ['a token endpoint on the metadata service', { token_endpoint: 'http://169.254.169.254/' }],
    ['a token endpoint on another public host', { token_endpoint: 'https://attacker.example/t' }],
    ['a javascript authorization endpoint', { authorization_endpoint: 'javascript:alert(1)' }],
  ])('refuses a document with %s', async (_name, overrides) => {
    stub_fetch({ ...authorization_server_metadata, ...overrides });

    await expect(
      discover_mcp_authorization({
        endpoint_url: 'https://brain.example.test/mcp',
        www_authenticate: null,
        lookup_addresses,
      }),
    ).rejects.toThrow('Refused to use the');
  });

  it('still refuses a server whose authorization metadata cannot be read at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );

    await expect(
      discover_mcp_authorization({
        endpoint_url: 'https://nothing.example.test/mcp',
        www_authenticate: null,
        lookup_addresses,
      }),
    ).rejects.toThrow('Could not read the authorization server metadata.');
  });
});
