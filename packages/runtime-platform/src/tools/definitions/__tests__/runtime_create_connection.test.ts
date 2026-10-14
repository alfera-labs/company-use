import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const find_app_to_connect = vi.fn();
const create_pending_connection_setup = vi.fn();
const read_connector_app_hold = vi.fn();

vi.mock('@coworker/core/db/queries/app_to_connect', () => ({
  find_app_to_connect: (...args: unknown[]) => find_app_to_connect(...args),
}));
vi.mock('@coworker/core/db/queries/connection_management', () => ({
  create_pending_connection_setup: (...args: unknown[]) => create_pending_connection_setup(...args),
}));
vi.mock('@coworker/connectors', () => ({
  connector_catalog_source: 'connector_registry',
  read_connector_app_hold: (app_name: string) => read_connector_app_hold(app_name),
}));
vi.mock('@runtime-platform/connections/connection_resume_intent', () => ({
  build_connection_resume_intent: async () => null,
  max_resume_instruction_length: 500,
}));
vi.mock('@runtime-platform/connections/connection_start_link', () => ({
  build_connection_start_url: () => 'http://app.localhost:3000/connect/start?x=1',
}));
vi.mock('@coworker/config/public_env', () => ({
  public_env: { NEXT_PUBLIC_APP_URL: 'http://app.localhost:3000' },
}));

import { runtime_create_connection_tool } from '@runtime-platform/tools/definitions/runtime_create_connection';

const profile = {
  provider_configs: [
    {
      provider_key: 'native',
      provider_config_key: 'native:gmail',
      version: 1,
      status: 'active',
      connection_profiles: [
        {
          connection_profile_key: 'native:gmail:default',
          version: 1,
          status: 'active',
          setup_strategy: { type: 'api_key' },
        },
      ],
    },
  ],
};
const oauth_client_nobody_set = {
  type: 'oauth2_authorization_code',
  client_id_env: 'CONNECTOR_NOBODY_SET_CLIENT_ID',
  client_secret_env: 'CONNECTOR_NOBODY_SET_CLIENT_SECRET',
};
const native_gmail = {
  app_id: 'app_native',
  app_name: 'gmail',
  app_display_name: 'Gmail',
  display_config: {},
  metadata: { source: 'connector_registry', ...profile },
};
const composio_gmail = {
  app_id: 'app_composio',
  app_name: 'composio_gmail',
  app_display_name: 'Gmail',
  display_config: {},
  metadata: { source: 'composio', ...profile },
};
const context = {
  db: {},
  workspace_id: 'ws_1',
  actor_id: 'user_1',
  session_id: 'ses_1',
} as unknown as RuntimeToolExecutionContext;

describe('create_connection with a held native connector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    read_connector_app_hold.mockImplementation((name: string) =>
      name === 'gmail' ? { reason: 'Google has not approved this app yet.' } : null,
    );
    create_pending_connection_setup.mockResolvedValue({
      connection: { connection_id: 'conn_1' },
      setup: { setup_token: 'tok' },
    });
  });

  it('connects through the composio app instead of the held native one', async () => {
    find_app_to_connect.mockResolvedValue(composio_gmail);
    const result = await runtime_create_connection_tool.execute({ app_name: 'gmail' }, context);
    expect(result.success).toBe(true);
    expect(create_pending_connection_setup.mock.calls[0]?.[1]).toMatchObject({
      app_id: 'app_composio',
    });
  });

  it('refuses with the hold reason when no composio app exists', async () => {
    find_app_to_connect.mockResolvedValue(native_gmail);
    const result = await runtime_create_connection_tool.execute({ app_name: 'gmail' }, context);
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.code).toBe('app_on_hold');
    expect(create_pending_connection_setup).not.toHaveBeenCalled();
  });

  it('refuses an app this deployment cannot connect, and starts no setup', async () => {
    const [config] = profile.provider_configs;
    find_app_to_connect.mockResolvedValue({
      ...composio_gmail,
      metadata: {
        source: 'composio',
        provider_configs: [
          {
            ...config,
            connection_profiles: [
              { ...config?.connection_profiles[0], setup_strategy: oauth_client_nobody_set },
            ],
          },
        ],
      },
    });

    const result = await runtime_create_connection_tool.execute({ app_name: 'gmail' }, context);

    expect(result).toMatchObject({ success: false, error: { code: 'app_on_hold' } });
    expect(result.success === false && result.error.message).toBe(
      'Gmail cannot be connected yet: Gmail is not set up on this deployment: its OAuth client (CONNECTOR_NOBODY_SET_CLIENT_ID and CONNECTOR_NOBODY_SET_CLIENT_SECRET) is missing. Tell the person this in one sentence and send no connect link.',
    );
    expect(create_pending_connection_setup).not.toHaveBeenCalled();
  });

  it('leaves apps without a hold alone', async () => {
    read_connector_app_hold.mockReturnValue(null);
    find_app_to_connect.mockResolvedValue(native_gmail);
    const result = await runtime_create_connection_tool.execute({ app_name: 'gmail' }, context);
    expect(result.success).toBe(true);
    expect(create_pending_connection_setup.mock.calls[0]?.[1]).toMatchObject({
      app_id: 'app_native',
    });
  });
});
