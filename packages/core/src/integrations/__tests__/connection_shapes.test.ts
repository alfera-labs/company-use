import { parse_agent_enabled_nodes } from '@coworker/core/integrations/agent_enabled_nodes';
import { parse_app_provider_configs } from '@coworker/core/integrations/app_provider_configs';
import { describe, expect, it } from 'vitest';

describe('connection management shape parsers', () => {
  it('accepts multiple provider configs and connection profiles for one app', () => {
    const configs = parse_app_provider_configs({
      provider_configs: [
        provider_config('composio:gmail', [
          connection_profile('composio:gmail:managed_oauth'),
          connection_profile('composio:gmail:readonly_oauth'),
        ]),
        provider_config('native:gmail', [connection_profile('native:gmail:oauth')], 'native'),
      ],
    });

    expect(configs).toHaveLength(2);
    expect(
      configs[0]?.connection_profiles.map((profile) => profile.connection_profile_key),
    ).toEqual(['composio:gmail:managed_oauth', 'composio:gmail:readonly_oauth']);
  });

  it('rejects duplicate provider config versions', () => {
    expect(() =>
      parse_app_provider_configs({
        provider_configs: [provider_config('composio:gmail'), provider_config('composio:gmail')],
      }),
    ).toThrow(/Duplicate provider_config_key \+ version/u);
  });

  it('rejects duplicate connection profile versions', () => {
    expect(() =>
      parse_app_provider_configs({
        provider_configs: [
          provider_config('composio:gmail', [
            connection_profile('composio:gmail:managed_oauth'),
            connection_profile('composio:gmail:managed_oauth'),
          ]),
        ],
      }),
    ).toThrow(/Duplicate connection_profile_key \+ version/u);
  });

  it('accepts concrete enabled nodes and preserves selector policy fields', () => {
    const enabled_nodes = parse_agent_enabled_nodes({
      enabled_nodes: [
        {
          node_key: 'gmail-send_email-1',
          provider_key: 'composio',
          status: 'enabled',
          connection_selector: {
            strategy: 'specific_connection',
            connection_id: 'conn_123',
          },
          input_defaults: { subject: 'Hello' },
          approval_policy_override: { mode: 'manual_review' },
        },
      ],
    });

    expect(enabled_nodes[0]).toMatchObject({
      node_key: 'gmail-send_email-1',
      provider_key: 'composio',
      connection_selector: { strategy: 'specific_connection', connection_id: 'conn_123' },
      input_defaults: { subject: 'Hello' },
      approval_policy_override: { mode: 'manual_review' },
    });
  });
});

function provider_config(
  provider_config_key: string,
  connection_profiles = [connection_profile(`${provider_config_key}:managed_oauth`)],
  provider_key = 'composio',
) {
  return {
    provider_key,
    provider_config_key,
    version: 1,
    status: 'active',
    provider_app_key: provider_config_key.split(':').at(-1),
    setup_defaults: {},
    connection_profiles,
  };
}

function connection_profile(connection_profile_key: string) {
  return {
    connection_profile_key,
    version: 1,
    status: 'active',
    auth_method_key: 'managed_oauth',
    setup_strategy: { type: 'connect_token' },
    runtime_credential_strategy: { type: 'provider_account_reference' },
    default_scopes: [],
  };
}
