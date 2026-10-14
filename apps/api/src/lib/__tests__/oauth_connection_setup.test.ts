import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { build_connection_return_uri } from '@runtime-platform/connections/connection_return_uri';
import {
  build_public_connection_setup,
  exchange_oauth_code_for_tokens,
} from '@runtime-platform/connections/oauth_connection_setup';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = await create_test_database();

afterEach(() => {
  delete process.env.API_PUBLIC_URL;
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;
  delete process.env.SLACK_TEAM_ID;
  vi.unstubAllGlobals();
});

describe('hosted setup return links', () => {
  it('carries the pending connection id into hosted setup return URLs', () => {
    const return_uri = build_connection_return_uri(
      'http://localhost:3000/connect/callback?source=composio',
      {
        connection_id: 'conn_123',
        provider_key: 'composio',
      },
    );
    const url = new URL(return_uri);

    expect(url.searchParams.get('source')).toBe('composio');
    expect(url.searchParams.get('connection_id')).toBe('conn_123');
    expect(url.searchParams.get('provider_key')).toBe('composio');
  });

  it('refuses a hosted setup return URL on an origin that is not ours', () => {
    expect(() =>
      build_connection_return_uri('https://attacker.example/connect/callback', {
        connection_id: 'conn_123',
        provider_key: 'composio',
        setup_token: 'secret',
      }),
    ).toThrow('redirect_uri must be on an allowed origin');
  });
});

describe('oauth connection setup', () => {
  it('names missing Slack OAuth env vars before opening setup', async () => {
    const setup = await build_public_connection_setup({
      setup_state: slack_oauth_setup_state(),
      db,
    });

    expect(setup.setup_error).toContain('SLACK_CLIENT_ID');
    expect(setup.setup_error).toContain('SLACK_CLIENT_SECRET');
    expect((setup as { authorization_url?: string }).authorization_url).toBeUndefined();
  });

  it('builds Slack OAuth authorization URLs with comma separated scopes', async () => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_123';

    const setup = await build_public_connection_setup({
      setup_state: slack_oauth_setup_state(),
      db,
    });
    const authorization_url = new URL(
      String((setup as { authorization_url?: string }).authorization_url),
    );

    expect(setup.setup_error).toBeNull();
    expect(authorization_url.origin).toBe('https://slack.com');
    expect(authorization_url.searchParams.get('client_id')).toBe('slack_client_123');
    expect(authorization_url.searchParams.get('redirect_uri')).toContain(
      '/v1/connections/oauth/callback',
    );
    expect(authorization_url.searchParams.get('redirect_uri')).not.toContain('/connect/callback');
    expect(authorization_url.searchParams.get('scope')).toBe('channels:read,channels:join');
    expect(authorization_url.searchParams.has('code_challenge')).toBe(false);
  });

  it('passes provider authorization params into OAuth URLs', async () => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_123';

    const setup = await build_public_connection_setup({
      setup_state: slack_oauth_setup_state({
        oauth_authorization_params: { team: 'T123' },
      }),
      db,
    });
    const authorization_url = new URL(
      String((setup as { authorization_url?: string }).authorization_url),
    );

    expect(setup.setup_error).toBeNull();
    expect(authorization_url.searchParams.get('team')).toBe('T123');
  });

  it('uses the public API URL for provider OAuth callbacks', async () => {
    process.env.API_PUBLIC_URL = 'https://api-public.example.com';
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_123';

    const setup = await build_public_connection_setup({
      setup_state: slack_oauth_setup_state(),
      db,
    });
    const authorization_url = new URL(
      String((setup as { authorization_url?: string }).authorization_url),
    );

    expect(authorization_url.searchParams.get('redirect_uri')).toBe(
      'https://api-public.example.com/v1/connections/oauth/callback',
    );
  });

  it('validates and normalizes Slack token responses at the HTTP boundary', async () => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_123';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          access_token: '  xoxb-token  ',
          refresh_token: '  refresh-token  ',
          id_token: '  id-token  ',
          bot_access_token: '  bot-token  ',
          token_type: '  bot  ',
          scope: '  channels:read,channels:join  ',
          scopes: '  channels:read channels:join  ',
          expires_in: 3600,
          account_id: '  account-123  ',
          account_name: '  Account name  ',
          team_id: '  T123  ',
          team_name: '  Acme  ',
          team: { id: '  T123  ', name: '  Acme  ' },
          authed_user: { id: '  U123  ' },
        }),
      ),
    );

    const token_response = await exchange_oauth_code_for_tokens({
      setup_state: slack_oauth_setup_state(),
      code: 'oauth_code_123',
    });

    expect(token_response).toMatchObject({
      ok: true,
      access_token: 'xoxb-token',
      refresh_token: 'refresh-token',
      id_token: 'id-token',
      bot_access_token: 'bot-token',
      token_type: 'bot',
      scope: 'channels:read,channels:join',
      scopes: 'channels:read channels:join',
      expires_in: 3600,
      account_id: 'account-123',
      account_name: 'Account name',
      team_id: 'T123',
      team_name: 'Acme',
      team: { id: 'T123', name: 'Acme' },
      authed_user: { id: 'U123' },
    });
  });

  it.each([
    [{ access_token: 'xoxb-token', team: { id: 'T123' } }, 'ok'],
    [{ ok: true, access_token: 'xoxb-token' }, 'team'],
    [{ ok: true, team: { id: 'T123' } }, 'access_token'],
  ])('rejects HTTP 200 Slack responses missing provider success fields', async (response_body, invalid_field) => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_123';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response_body)));

    await expect(
      exchange_oauth_code_for_tokens({
        setup_state: slack_oauth_setup_state(),
        code: 'oauth_code_123',
      }),
    ).rejects.toThrow(`invalid slack response: ${invalid_field}`);
  });

  it('rejects malformed consumed token fields instead of persisting them', async () => {
    process.env.SLACK_CLIENT_ID = 'slack_client_123';
    process.env.SLACK_CLIENT_SECRET = 'slack_secret_123';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          access_token: 'xoxb-token',
          expires_in: '3600',
          team: { id: 'T123' },
        }),
      ),
    );

    await expect(
      exchange_oauth_code_for_tokens({
        setup_state: slack_oauth_setup_state(),
        code: 'oauth_code_123',
      }),
    ).rejects.toThrow('invalid slack response: expires_in');
  });
});

function slack_oauth_setup_state(overrides: Record<string, unknown> = {}) {
  return {
    type: 'oauth2_authorization_code',
    provider_app_key: 'slack',
    redirect_uri: 'http://localhost:3000/connect/callback',
    oauth_authorization_url: 'https://slack.com/oauth/v2/authorize',
    oauth_token_url: 'https://slack.com/api/oauth.v2.access',
    oauth_state_token: 'state_123',
    oauth_client_id_env: 'SLACK_CLIENT_ID',
    oauth_client_secret_env: 'SLACK_CLIENT_SECRET',
    oauth_scopes: ['channels:read', 'channels:join'],
    oauth_scope_separator: 'comma',
    oauth_token_auth_method: 'client_secret_post',
    oauth_code_challenge: null,
    ...overrides,
  };
}
