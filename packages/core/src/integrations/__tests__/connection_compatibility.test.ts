import {
  find_missing_scopes,
  validate_node_execution_compatibility,
} from '@coworker/core/integrations/connection_compatibility';
import { describe, expect, it } from 'vitest';

const selector = { strategy: 'latest_active_matching_connection' } as const;

describe('connection compatibility', () => {
  it('accepts exact node and connection provider/profile matches', () => {
    expect(validate_node_execution_compatibility(node(), connection(), selector)).toEqual({
      ok: true,
    });
  });

  it('rejects provider mismatches', () => {
    expect(
      validate_node_execution_compatibility(
        node(),
        connection({ provider_key: 'native' }),
        selector,
      ),
    ).toMatchObject({ ok: false, reason: 'connection_provider_mismatch' });
  });

  it('rejects provider config version mismatches', () => {
    expect(
      validate_node_execution_compatibility(
        node(),
        connection({ provider_config_version: 2 }),
        selector,
      ),
    ).toMatchObject({ ok: false, reason: 'connection_provider_config_mismatch' });
  });

  it('rejects connection profile version mismatches', () => {
    expect(
      validate_node_execution_compatibility(
        node(),
        connection({ connection_profile_version: 2 }),
        selector,
      ),
    ).toMatchObject({ ok: false, reason: 'connection_profile_mismatch' });
  });

  it('rejects missing scopes', () => {
    expect(
      validate_node_execution_compatibility(
        node({ required_scopes: ['gmail.send', 'gmail.read'] }),
        connection({ authorized_scopes: ['gmail.read'] }),
        selector,
      ),
    ).toMatchObject({
      ok: false,
      reason: 'connection_missing_scopes',
      details: { missing_scopes: ['gmail.send'] },
    });
  });

  it('rejects retired nodes but allows deprecated nodes', () => {
    expect(
      validate_node_execution_compatibility(
        node({ node_status: 'retired' }),
        connection(),
        selector,
      ),
    ).toMatchObject({
      ok: false,
      reason: 'node_retired',
    });
    expect(
      validate_node_execution_compatibility(
        node({ node_status: 'deprecated' }),
        connection(),
        selector,
      ),
    ).toEqual({ ok: true });
  });

  it('calculates missing scopes without mutating inputs', () => {
    expect(find_missing_scopes(['a', 'b'], ['b', 'c'])).toEqual(['a']);
  });
});

function node(overrides: Record<string, unknown> = {}) {
  return {
    app_id: 'app_gmail',
    node_status: 'active',
    provider_key: 'composio',
    provider_config_key: 'composio:gmail',
    provider_config_version: 1,
    connection_profile_key: 'composio:gmail:managed_oauth',
    connection_profile_version: 1,
    required_scopes: [],
    ...overrides,
  };
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    app_id: 'app_gmail',
    connection_status: 'active',
    health_status: 'healthy',
    provider_key: 'composio',
    provider_config_key: 'composio:gmail',
    provider_config_version: 1,
    connection_profile_key: 'composio:gmail:managed_oauth',
    connection_profile_version: 1,
    authorized_scopes: [],
    ...overrides,
  };
}
