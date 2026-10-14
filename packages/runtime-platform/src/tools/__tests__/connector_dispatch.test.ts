import type { ConnectorResult } from '@coworker/connectors';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { connections } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { execute_catalog_tool } from '@runtime-platform/tools/catalog_tool_execution';
import { runtime_search_tools_tool } from '@runtime-platform/tools/definitions/runtime_search_tools';
import { beforeEach, expect, it, vi } from 'vitest';

const execute_node =
  vi.fn<
    (node_key: string, input: unknown, connection: unknown) => Promise<ConnectorResult<unknown>>
  >();

vi.mock('@coworker/connectors', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/connectors')>();
  return {
    ...actual,
    execute_node: (...args: Parameters<typeof execute_node>) => execute_node(...args),
  };
});

const { get_connector_app, seed_connector_catalog } = await import('@coworker/connectors');

const gmail_node_key = 'gmail-list_messages-1';
const notion_node_key = 'notion-search_pages-1';

beforeEach(() => {
  execute_node.mockReset();
});

it('runs a connectors.* node through the door with the workspace connection', async () => {
  const fixture = await connector_fixture({ connect_gmail: true });
  execute_node.mockResolvedValue({ ok: true, data: { messages: [], next_cursor: null } });

  const result = await execute_catalog_tool(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: 'run_connector_dispatch',
    actor_id: fixture.user_id,
    node_key: gmail_node_key,
    tool_input: { query: 'is:unread' },
  });

  expect(execute_node).toHaveBeenCalledWith(
    gmail_node_key,
    { query: 'is:unread' },
    { connection_id: 'conn_gmail', access_token: 'gmail_access_token' },
    expect.anything(),
  );
  expect(result.success).toBe(true);
  expect(result).toMatchObject({
    success: true,
    data: { node_key: gmail_node_key, app_name: 'gmail', output: { messages: [] } },
    metadata: { source: 'connectors', connection_id: 'conn_gmail' },
  });
});

it('maps a connector error onto the tool failure contract', async () => {
  const fixture = await connector_fixture({ connect_gmail: true });
  execute_node.mockResolvedValue({
    ok: false,
    error: { code: 'rate_limited', message: 'Gmail asked for a pause.', retryable: true },
  });

  const result = await execute_catalog_tool(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: 'run_connector_dispatch',
    actor_id: fixture.user_id,
    node_key: gmail_node_key,
    tool_input: {},
  });

  expect(result).toMatchObject({
    success: false,
    error: { code: 'rate_limited', message: 'Gmail asked for a pause.' },
    metadata: { source: 'connectors', retryable: true },
  });
});

it('refuses the call when the workspace has no connection for the app', async () => {
  const fixture = await connector_fixture({ connect_gmail: false });

  const result = await execute_catalog_tool(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: 'run_connector_dispatch',
    actor_id: fixture.user_id,
    node_key: gmail_node_key,
    tool_input: {},
  });

  expect(execute_node).not.toHaveBeenCalled();
  expect(result).toMatchObject({ success: false, error: { code: 'connection_missing' } });
});

it('offers a connector node only to a workspace that connected its app', async () => {
  const unconnected = await connector_fixture({ connect_gmail: false });
  expect(await searched_node_keys(unconnected, 'notion search pages')).not.toContain(
    notion_node_key,
  );

  const connected = await connector_fixture({ connect_gmail: false, connect_notion: true });
  expect(await searched_node_keys(connected, 'notion search pages')).toContain(notion_node_key);
});

it('never offers a held app, even to a workspace that connected it', async () => {
  const connected = await connector_fixture({ connect_gmail: true });

  expect(await searched_node_keys(connected, 'gmail list messages')).not.toContain(gmail_node_key);
});

type ConnectorFixture = Awaited<ReturnType<typeof connector_fixture>>;

async function searched_node_keys(fixture: ConnectorFixture, query: string) {
  const result = await runtime_search_tools_tool.execute(
    { query, max_results: 50, offset: 0 },
    {
      db: fixture.db,
      workspace_id: fixture.workspace_id,
      session_id: fixture.session_id,
      run_id: 'run_connector_offering',
      agent_id: fixture.agent_id,
      actor_id: fixture.user_id,
    },
  );
  if (!result.success) throw new Error('Tool search failed');
  const tools = (result.data as { tools: Array<{ node_key: string }> }).tools;
  return tools.map((tool) => tool.node_key);
}

async function connector_fixture(input: { connect_gmail: boolean; connect_notion?: boolean }) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await seed_connector_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });

  if (input.connect_gmail) await connect_native_app(db, bootstrap.workspace_id, 'gmail');
  if (input.connect_notion) await connect_native_app(db, bootstrap.workspace_id, 'notion');

  return {
    db,
    workspace_id: bootstrap.workspace_id,
    user_id: bootstrap.user_id,
    agent_id: bootstrap.agent_id,
    session_id: session.session_id,
  };
}

async function connect_native_app(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
  app_name: string,
) {
  const app_row = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, app_name),
  });
  if (!app_row) throw new Error(`The ${app_name} connector app was not seeded`);
  await db.insert(connections).values({
    connection_id: `conn_${app_name}`,
    workspace_id,
    app_id: app_row.app_id,
    connection_key: `native:${app_name}:conn_${app_name}`,
    connection_name: app_name,
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: `native:${app_name}`,
    provider_config_version: 1,
    connection_profile_key: `native:${app_name}:default`,
    connection_profile_version: 1,
    auth_method_key: 'oauth2_authorization_code',
    external_account_id: `${app_name}_account_1`,
    authorized_scopes: [...(get_connector_app(app_name)?.auth.scopes ?? [])],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: `${app_name}_access_token` },
    }),
    created_by: 'test',
    last_updated_by: 'test',
  });
}
