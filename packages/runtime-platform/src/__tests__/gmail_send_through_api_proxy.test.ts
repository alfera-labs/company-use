import { nodes } from '@coworker/core/db/schema';
import { reset_composio_client_for_tests } from '@runtime-platform/composio/composio_client';
import {
  create_gmail_fixture,
  insert_composio_gmail_connection,
} from '@runtime-platform/tools/gmail/__tests__/gmail_fixture';
import { execute_runtime_tool } from '@runtime-platform/tools/tool_execution_service';
import { afterEach, describe, expect, it, vi } from 'vitest';

type GmailFixture = Awaited<ReturnType<typeof create_gmail_fixture>>;

function run_tool(fixture: GmailFixture, node_key: string, tool_input: Record<string, unknown>) {
  return execute_runtime_tool(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: fixture.run_id,
    agent_id: fixture.agent_id,
    actor_id: fixture.user_id,
    node_key,
    tool_input,
  });
}

function call_proxy(fixture: GmailFixture, node_key: string, input: Record<string, unknown>) {
  return run_tool(fixture, 'runtime-execute_tool-1', { node_key, input });
}

describe('a Gmail send through the Composio API proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it.each([
    '/users/me/messages/send',
    '/gmail/v1/users/me/drafts/send',
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
  ])('is refused before Composio is called: POST %s', async (url) => {
    const fixture = await create_gmail_fixture();
    await insert_composio_gmail_connection(fixture);
    await fixture.db.insert(nodes).values(composio_gmail_post_proxy(fixture.user_id));
    const composio_api = vi.fn();
    vi.stubGlobal('fetch', composio_api);

    const { result } = await call_proxy(fixture, 'gmail_v2-post_api_proxy-1', {
      url,
      body: { id: 'r-draft' },
    });

    expect(result).toMatchObject({ success: false, error: { code: 'blocked_by_policy' } });
    expect(composio_api).not.toHaveBeenCalled();
  });
});

function composio_gmail_post_proxy(actor_id: string): typeof nodes.$inferInsert {
  return {
    node_id: 'node_gmail_v2_post_api_proxy',
    app_id: 'app_gmail_composio',
    app_key: 'gmail_v2',
    catalog_scope: 'global',
    node_key: 'gmail_v2-post_api_proxy-1',
    node_name: 'post_api_proxy',
    node_version: 1,
    node_display_name: 'POST API proxy request',
    node_kind: 'action',
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object' },
    approval_policy: { mode: 'none' },
    runtime_handler: 'composio.api_proxy',
    node_runtime: 'connected_app',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'composio',
    provider_config_key: 'composio:gmail',
    provider_config_version: 1,
    connection_profile_key: 'composio:gmail:oauth2',
    connection_profile_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: {
      proxy: {
        method: 'POST',
        url_mode: 'static_domain',
        base_proxy_target_url: 'https://gmail.googleapis.com/gmail/v1',
      },
    },
    metadata: { source: 'composio', required_connection: true },
    created_by: actor_id,
    last_updated_by: actor_id,
  };
}
