import { afterEach, describe, expect, it, vi } from 'vitest';

const setup_state = { connection_id: 'con_1', provider_key: 'mcp', setup_token: 'token_1' };

async function load_with_allowed_origins(allowed_origins: string) {
  vi.resetModules();
  vi.stubEnv('ALLOWED_ORIGINS', allowed_origins);
  return import('@runtime-platform/connections/connection_return_uri');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('build_connection_return_uri', () => {
  it('accepts the address a browser sends when the install stored its name with capitals', async () => {
    const { build_connection_return_uri } = await load_with_allowed_origins(
      'http://localhost:3370,http://Office-Mac.local:3370',
    );

    expect(
      build_connection_return_uri('http://office-mac.local:3370/connect/callback', setup_state),
    ).toBe(
      'http://office-mac.local:3370/connect/callback?connection_id=con_1&provider_key=mcp&setup_token=token_1',
    );
  });

  it('accepts a host written with a dot at its end on either side', async () => {
    const { build_connection_return_uri, allowed_return_origins } = await load_with_allowed_origins(
      'https://Alfera.Example.com.',
    );

    expect([...allowed_return_origins()]).toEqual(['https://alfera.example.com']);
    expect(() =>
      build_connection_return_uri('https://alfera.example.com./connect/callback', setup_state),
    ).not.toThrow();
  });

  it('still refuses an address on another origin', async () => {
    const { build_connection_return_uri } = await load_with_allowed_origins(
      'http://Office-Mac.local:3370',
    );

    for (const elsewhere of [
      'http://office-mac.local:9999/connect/callback',
      'http://elsewhere.example.com/connect/callback',
    ]) {
      expect(() => build_connection_return_uri(elsewhere, setup_state)).toThrow(
        'redirect_uri must be on an allowed origin',
      );
    }
  });
});
