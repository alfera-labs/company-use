import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_apps, list_nodes } from '@coworker/core/db/queries/catalog';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { get_all_tools } from '@runtime-platform/tools/tool_registry';
import { describe, expect, it } from 'vitest';

describe('runtime catalog seed', () => {
  it('persists every registered runtime tool schema into apps and nodes', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);

    await seed_runtime_tool_catalog(db);
    await seed_runtime_tool_catalog(db);

    const apps = await list_apps(db);
    const nodes = await list_nodes(db);
    const node_keys = get_all_tools().map((tool) => tool.node_key);
    const seeded_node_keys = nodes.map((node) => node.node_key);

    expect(apps.map((app) => app.app_name)).toEqual(
      expect.arrayContaining(['math', 'runtime', 'slack']),
    );
    expect(seeded_node_keys).toEqual(expect.arrayContaining(node_keys));
    expect(nodes.filter((node) => node.node_name === 'search_context')).toHaveLength(1);
    expect(nodes.find((node) => node.node_name === 'search_context')).toMatchObject({
      runtime_handler: 'runtime.search_context',
      input_schema: expect.objectContaining({
        properties: expect.objectContaining({
          query: expect.any(Object),
          max_results: expect.any(Object),
        }),
      }),
    });
    expect(nodes.find((node) => node.node_name === 'search_tools')).toMatchObject({
      runtime_handler: 'runtime.search_tools',
    });
    expect(nodes.find((node) => node.node_name === 'get_tool_schema')).toMatchObject({
      runtime_handler: 'runtime.get_tool_schema',
    });
    expect(nodes.find((node) => node.node_name === 'execute_tool')).toMatchObject({
      runtime_handler: 'runtime.execute_tool',
    });
    expect(nodes.find((node) => node.node_name === 'calculate')).toMatchObject({
      runtime_handler: 'math.calculate',
      provider_key: 'native',
      connection_profile_key: null,
      input_schema: expect.objectContaining({
        required: ['expression'],
      }),
    });
    expect(apps.find((app) => app.app_name === 'slack')).toMatchObject({
      auth_type: 'oauth2',
      metadata: {
        provider_configs: [
          expect.objectContaining({
            provider_key: 'native',
            provider_config_key: 'native:slack',
            connection_profiles: [
              expect.objectContaining({
                connection_profile_key: 'native:slack:oauth_bot',
                auth_method_key: 'slack_oauth2_bot',
                default_scopes: expect.arrayContaining([
                  'app_mentions:read',
                  'channels:join',
                  'chat:write',
                  'chat:write.public',
                  'files:write',
                  'reactions:write',
                  'users:read',
                  'users:read.email',
                ]),
              }),
            ],
          }),
        ],
      },
    });
    const slack_app_metadata = apps.find((app) => app.app_name === 'slack')?.metadata as
      | {
          provider_configs?: Array<{
            connection_profiles?: Array<{ default_scopes?: string[] }>;
          }>;
        }
      | undefined;
    const slack_profile = slack_app_metadata?.provider_configs?.[0]?.connection_profiles?.[0];
    expect(slack_profile?.default_scopes).not.toEqual(
      expect.arrayContaining(['commands', 'chat:write.customize', 'search:read.public']),
    );
    expect(nodes.find((node) => node.node_name === 'list_channels')).toMatchObject({
      app_key: 'slack',
      node_key: 'slack-list_channels-1',
      node_version: 1,
      provider_key: 'native',
      provider_config_key: 'native:slack',
      connection_profile_key: 'native:slack:oauth_bot',
      required_scopes: ['channels:read'],
      node_config: {
        sourced_from: {
          provider: 'native',
          provider_app_id: 'native:slack',
          provider_component_id: 'slack.list_channels',
          provider_component_version: '1',
        },
      },
    });
    expect(nodes.find((node) => node.node_name === 'list_workspace_members')).toMatchObject({
      provider_key: 'native',
      provider_config_key: 'native:slack',
      connection_profile_key: 'native:slack:oauth_bot',
      runtime_handler: 'slack.list_workspace_members',
      required_scopes: ['users:read', 'users:read.email'],
      approval_policy: { mode: 'none' },
    });
    expect(nodes.find((node) => node.node_name === 'create_connection')).toMatchObject({
      runtime_handler: 'runtime.create_connection',
      connection_profile_key: null,
      provider_key: 'native',
    });
    expect(nodes.find((node) => node.node_name === 'join_channel')).toMatchObject({
      provider_key: 'native',
      provider_config_key: 'native:slack',
      connection_profile_key: 'native:slack:oauth_bot',
      required_scopes: ['channels:join'],
      approval_policy: { mode: 'none' },
    });
    expect(nodes.find((node) => node.node_key === 'slack-upload_file-1')).toMatchObject({
      provider_key: 'native',
      provider_config_key: 'native:slack',
      connection_profile_key: 'native:slack:oauth_bot',
      runtime_handler: 'slack.upload_file',
      required_scopes: ['files:write', 'im:write'],
      approval_policy: { mode: 'none' },
      input_schema: expect.objectContaining({
        required: ['file_path'],
      }),
    });
  });
});
