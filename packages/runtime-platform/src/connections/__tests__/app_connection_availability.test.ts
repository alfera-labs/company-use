import { find_why_app_cannot_connect_here } from '@runtime-platform/connections/app_connection_availability';
import { afterEach, describe, expect, it, vi } from 'vitest';

function app_with_profile(provider_key: string, setup_strategy: Record<string, unknown>) {
  return {
    app_display_name: 'Notion',
    metadata: {
      provider_configs: [
        {
          provider_key,
          provider_config_key: `${provider_key}:notion`,
          version: 1,
          status: 'active',
          setup_defaults: {},
          connection_profiles: [
            {
              connection_profile_key: `${provider_key}:notion:default`,
              version: 1,
              status: 'active',
              auth_method_key: 'oauth2_authorization_code',
              setup_strategy,
              runtime_credential_strategy: {},
              default_scopes: [],
            },
          ],
        },
      ],
    },
  };
}

const native_oauth = {
  type: 'oauth2_authorization_code',
  client_id_env: 'CONNECTOR_NOTION_CLIENT_ID',
  client_secret_env: 'CONNECTOR_NOTION_CLIENT_SECRET',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('whether this deployment can connect an app', () => {
  it('names the OAuth client a native connector lacks', () => {
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_ID', '');
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_SECRET', '');

    expect(find_why_app_cannot_connect_here(app_with_profile('native', native_oauth))).toBe(
      'Notion is not set up on this deployment: its OAuth client (CONNECTOR_NOTION_CLIENT_ID and CONNECTOR_NOTION_CLIENT_SECRET) is missing.',
    );
  });

  it('connects a native connector whose OAuth client is set', () => {
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_ID', 'client');
    vi.stubEnv('CONNECTOR_NOTION_CLIENT_SECRET', 'secret');

    expect(find_why_app_cannot_connect_here(app_with_profile('native', native_oauth))).toBeNull();
  });

  it('connects an app that brings its own OAuth client id', () => {
    const own_client = { type: 'oauth2_authorization_code', client_id: 'registered-by-the-server' };

    expect(find_why_app_cannot_connect_here(app_with_profile('mcp', own_client))).toBeNull();
  });

  it('names the catalogue key an app from the catalogue lacks', () => {
    const from_the_catalogue = app_with_profile('composio', { type: 'connect_link' });

    expect(find_why_app_cannot_connect_here(from_the_catalogue)).toBe(
      'Notion is not set up on this deployment: the app catalogue key (COMPOSIO_API_KEY) is missing.',
    );
  });

  it('does not connect an app that has a provider and no way to sign in', () => {
    const app = app_with_profile('native', {});
    const no_profile = {
      ...app,
      app_display_name: 'Math',
      metadata: {
        provider_configs: app.metadata.provider_configs.map((config) => ({
          ...config,
          connection_profiles: [],
        })),
      },
    };

    expect(find_why_app_cannot_connect_here(no_profile)).toBe(
      'Math is not set up on this deployment: it has no way to connect an account.',
    );
  });

  it('does not judge an app that connects the old way', () => {
    expect(find_why_app_cannot_connect_here({ app_display_name: 'Old', metadata: {} })).toBeNull();
    expect(
      find_why_app_cannot_connect_here({
        app_display_name: 'Public feed',
        auth_type: 'none',
        metadata: { sourced_from: { provider: 'composio' } },
      }),
    ).toBeNull();
  });

  it('does not connect a native app that needs a key the person types: no screen takes the key', () => {
    const app = app_with_profile('native', {});
    const with_a_typed_key = {
      ...app,
      app_display_name: 'Granola',
      metadata: {
        provider_configs: app.metadata.provider_configs.map((config) => ({
          ...config,
          connection_profiles: config.connection_profiles.map((profile) => ({
            ...profile,
            auth_method_key: 'api_key',
          })),
        })),
      },
    };

    expect(find_why_app_cannot_connect_here(with_a_typed_key)).toBe(
      'Granola is not set up on this deployment: it connects with an API key, and there is no place to enter that key yet.',
    );
  });

  it('does not connect the built-in app that has no account', () => {
    expect(
      find_why_app_cannot_connect_here({
        app_display_name: 'Alfera API',
        auth_type: 'none',
        metadata: { sourced_from: { provider: 'native' } },
      }),
    ).toBe('Alfera API is built in: there is no account to connect.');
  });
});
