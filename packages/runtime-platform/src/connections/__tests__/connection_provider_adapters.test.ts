import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';
import { find_connection_provider_adapter } from '@runtime-platform/connections/connection_provider_adapters';
import { describe, expect, it } from 'vitest';

describe('connection provider adapter lookup', () => {
  it('returns null for a prototype key, a blank key, and an unknown provider', () => {
    const refused: Array<string | null | undefined> = [
      '__proto__',
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      '',
      null,
      undefined,
      'nope',
    ];

    for (const provider_key of refused) {
      expect(find_connection_provider_adapter(provider_key)).toBeNull();
    }
  });

  it('returns each registered adapter under its own provider_key', () => {
    for (const provider_key of ['composio']) {
      expect(find_connection_provider_adapter(provider_key)?.provider_key).toBe(provider_key);
    }
  });

  it('exposes the webhook token and the account teardown on the composio adapter', () => {
    const composio = find_connection_provider_adapter('composio');

    expect(composio?.read_webhook_token?.(setup_state({ provider_webhook_token: ' tok_1 ' }))).toBe(
      'tok_1',
    );
    expect(
      composio?.read_webhook_token?.(setup_state({ provider_webhook_token: '  ' })),
    ).toBeNull();
    expect(composio?.read_webhook_token?.(setup_state({}))).toBeNull();
    expect(typeof composio?.revoke_external_account).toBe('function');
  });
});

function setup_state(state: ConnectionSetupStateData) {
  return { type: 'hosted_connect_link', ...state } satisfies ConnectionSetupStateData;
}
