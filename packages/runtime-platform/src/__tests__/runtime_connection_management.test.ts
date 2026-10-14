import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_run_message,
  create_session,
  list_run_tool_calls,
} from '@coworker/core/db/queries/sessions';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'test-app-catalogue-key';
});

const provider_api = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

const mcp_server_url = 'https://attio.mcp.test/mcp';

function stub_mcp_server() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method?: string };
      if (request.method === 'notifications/initialized')
        return new Response(null, { status: 202 });

      const result =
        request.method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: {},
              serverInfo: { name: 'attio-test', version: '1' },
            }
          : { content: [{ type: 'text', text: 'ok' }], isError: false };

      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('runtime connection management scoping', () => {
  beforeEach(() => {
    provider_api.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches visible catalog nodes without per-agent enabled-node setup', async () => {
    const fixture = await create_fixture();
    await insert_mcp_app_and_nodes(fixture);
    stub_mcp_server();

    const search_result = await fixture
      .tool('runtime-search_tools-1')
      ?.execute?.({ query: 'attio', max_results: 10 }, context(fixture));
    const natural_language_search_result = await fixture
      .tool('runtime-search_tools-1')
      ?.execute?.(
        { query: 'do you got attio connections or tools', max_results: 10 },
        context(fixture),
      );
    const app_scoped_search_result = await fixture
      .tool('runtime-search_tools-1')
      ?.execute?.(
        { query: 'attio search notes', app_name: 'attio', max_results: 10 },
        context(fixture),
      );
    const enabled_schema_result = await fixture
      .tool('runtime-get_tool_schema-1')
      ?.execute?.({ node_key: 'attio-search_people-1' }, context(fixture));
    const other_visible_schema_result = await fixture
      .tool('runtime-get_tool_schema-1')
      ?.execute?.({ node_key: 'attio-list_notes-1' }, context(fixture));
    const execute_result = await fixture
      .tool('runtime-execute_tool-1')
      ?.execute?.(
        { node_key: 'attio-search_people-1', input: { query: 'founder' } },
        context(fixture),
      );

    expect(search_result).toMatchObject({
      ok: true,
      content_json: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            node_key: 'attio-search_people-1',
            connection_status: 'not_required',
          }),
          expect.objectContaining({
            node_key: 'attio-list_notes-1',
            connection_status: 'not_required',
          }),
        ]),
      },
    });
    expect(natural_language_search_result).toMatchObject({
      ok: true,
      content_json: {
        tools: expect.arrayContaining([
          expect.objectContaining({ node_key: 'attio-search_people-1' }),
          expect.objectContaining({ node_key: 'attio-list_notes-1' }),
        ]),
      },
    });
    expect(app_scoped_search_result).toMatchObject({
      ok: true,
      content_json: {
        tools: expect.arrayContaining([
          expect.objectContaining({ node_key: 'attio-search_notes-1' }),
          expect.objectContaining({ node_key: 'attio-list_notes-1' }),
        ]),
      },
    });
    expect(JSON.stringify(search_result)).not.toContain('attio-old_search-1');
    expect(enabled_schema_result).toMatchObject({ ok: true });
    expect(other_visible_schema_result).toMatchObject({ ok: true });
    expect(execute_result).toMatchObject({ ok: true });

    const calls = await list_run_tool_calls(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
    );
    expect(calls.find((call) => call.tool_name === 'runtime-execute_tool-1')).toMatchObject({
      node_id: 'node_attio_search_people',
      connection_id: null,
      tool_status: 'completed',
    });
  });

  it('allows deprecated hidden nodes by direct schema lookup but rejects retired nodes', async () => {
    const fixture = await create_fixture();
    await insert_mcp_app_and_nodes(fixture);

    const hidden_schema_result = await fixture
      .tool('runtime-get_tool_schema-1')
      ?.execute?.({ node_key: 'attio-old_search-1' }, context(fixture));
    const retired_execute_result = await fixture
      .tool('runtime-execute_tool-1')
      ?.execute?.({ node_key: 'attio-retired_search-1', input: {} }, context(fixture));

    expect(hidden_schema_result).toMatchObject({ ok: false, error_code: 'tool_not_found' });
    expect(retired_execute_result).toMatchObject({ ok: false, error_code: 'node_retired' });
  });

  it('returns provider-sized app tool lists by default', async () => {
    const fixture = await create_fixture();
    await insert_mcp_app_and_nodes(fixture);
    await fixture.db
      .insert(nodes)
      .values(
        Array.from({ length: 30 }, (_, index) =>
          mcp_node(
            `node_attio_bulk_${index}`,
            `bulk_${index}`,
            `Bulk action ${index}`,
            'active',
            'visible',
          ),
        ),
      );

    const app_search_result = await fixture
      .tool('runtime-search_tools-1')
      ?.execute?.({ query: 'attio' }, context(fixture));

    expect(app_search_result).toMatchObject({
      ok: true,
      content_json: {
        result_count: 33,
        tools: expect.arrayContaining([
          expect.objectContaining({ node_key: 'attio-search_people-1' }),
          expect.objectContaining({ node_key: 'attio-bulk_29-1' }),
        ]),
      },
    });
  });

  it('lists current-workspace connections for connection questions', async () => {
    const fixture = await create_fixture();
    await insert_mcp_app_and_nodes(fixture);
    await fixture.db
      .insert(connections)
      .values([
        connection_row(fixture, 'conn_attio_pending', 'pending_setup', 'unknown'),
        connection_row(fixture, 'conn_attio_active', 'active', 'healthy'),
      ]);

    const all_connections_result = await fixture
      .tool('runtime-list_connections-1')
      ?.execute?.({ app_name: 'attio', include_inactive: true }, context(fixture));
    const active_connections_result = await fixture
      .tool('runtime-list_connections-1')
      ?.execute?.({ app_name: 'attio', include_inactive: false }, context(fixture));

    expect(all_connections_result).toMatchObject({
      ok: true,
      content_json: {
        workspace_id: fixture.bootstrap.workspace_id,
        result_count: 2,
        connections: [
          expect.objectContaining({
            connection_id: 'conn_attio_active',
            app_name: 'attio',
            connection_status: 'active',
            health_status: 'healthy',
          }),
          expect.objectContaining({
            connection_id: 'conn_attio_pending',
            app_name: 'attio',
            connection_status: 'pending_setup',
          }),
        ],
      },
    });
    expect(active_connections_result).toMatchObject({
      ok: true,
      content_json: {
        result_count: 1,
        connections: [
          expect.objectContaining({
            connection_id: 'conn_attio_active',
            connection_status: 'active',
          }),
        ],
      },
    });
  });

  it('returns a click-to-start connection setup link for connectable apps', async () => {
    const fixture = await create_fixture();
    vi.stubGlobal('fetch', provider_api);
    await insert_connectable_app(fixture, {
      app_id: 'app_hubspot',
      app_name: 'hubspot',
      app_display_name: 'HubSpot',
    });

    const result = await fixture
      .tool('runtime-create_connection-1')
      ?.execute?.({ app_name: 'hubspot' }, context(fixture));

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        type: 'connection_setup',
        app: {
          app_id: 'app_hubspot',
          app_name: 'hubspot',
          app_display_name: 'HubSpot',
        },
        start_url: expect.stringContaining('/connect/start?connection_id=conn_'),
        message_for_user: expect.stringContaining('[Connect HubSpot]('),
      },
      metadata: {
        ui_kind: 'connection_setup',
        connection_id: expect.stringMatching(/^conn_/),
        app_name: 'hubspot',
      },
    });
    if (!result?.ok) throw new Error('runtime-create_connection-1 should succeed');
    const start_url = read_start_url(result.content_json);
    const parsed_url = new URL(start_url);
    expect(parsed_url.pathname).toBe('/connect/start');
    expect(parsed_url.searchParams.get('connection_id')).toMatch(/^conn_/);
    expect(parsed_url.searchParams.get('setup_token')).toEqual(expect.any(String));
    expect(start_url).not.toContain('composio');
    expect(provider_api).not.toHaveBeenCalled();
  });

  it('captures a minimal resume intent when create_connection includes an instruction', async () => {
    const fixture = await create_fixture();
    await insert_connectable_app(fixture, {
      app_id: 'app_gmail',
      app_name: 'gmail',
      app_display_name: 'Gmail',
    });

    await fixture.tool('runtime-create_connection-1')?.execute?.(
      {
        app_name: 'gmail',
        resume_instruction: 'Pull the latest five Gmail emails and summarize them.',
      },
      context(fixture),
    );

    const connection = await fixture.db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.app_id, 'app_gmail'),
    });
    expect(connection?.setup_state).toMatchObject({
      setup_token: expect.any(String),
      resume: {
        session_id: fixture.session.session_id,
        actor_id: fixture.bootstrap.user_id,
        instruction: 'Pull the latest five Gmail emails and summarize them.',
        created_at: expect.any(String),
      },
    });
    expect(connection?.setup_state).not.toMatchObject({
      resume: expect.objectContaining({
        channel_id: expect.any(String),
        thread_ts: expect.any(String),
        user_id: expect.any(String),
      }),
    });
  });

  it('auto-carries the interrupted ask on every surface, chat as well as Slack', async () => {
    const fixture = await create_slack_fixture_with_user_message(
      'Pull my last 5 Gmail emails, summarize them, and create a Notion page.',
    );

    await fixture
      .tool('runtime-create_connection-1')
      ?.execute?.({ app_name: 'gmail' }, context(fixture));

    const connection = await fixture.db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.app_id, 'app_gmail'),
    });
    expect(connection?.setup_state).toMatchObject({
      setup_token: expect.any(String),
      resume: {
        session_id: fixture.session.session_id,
        instruction: 'Pull my last 5 Gmail emails, summarize them, and create a Notion page.',
        created_at: expect.any(String),
      },
    });

    const chat_fixture = await create_fixture();
    await insert_connectable_app(chat_fixture, {
      app_id: 'app_gmail',
      app_name: 'gmail',
      app_display_name: 'Gmail',
    });
    await create_run_message(chat_fixture.db, {
      workspace_id: chat_fixture.bootstrap.workspace_id,
      session_id: chat_fixture.session.session_id,
      run_id: chat_fixture.run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Summarize my unread Gmail.' },
      source_type: 'dashboard',
      actor_id: chat_fixture.bootstrap.user_id,
    });
    await chat_fixture
      .tool('runtime-create_connection-1')
      ?.execute?.({ app_name: 'gmail' }, context(chat_fixture));
    const chat_connection = await chat_fixture.db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.app_id, 'app_gmail'),
    });
    expect(chat_connection?.setup_state).toMatchObject({
      resume: {
        session_id: chat_fixture.session.session_id,
        instruction: 'Summarize my unread Gmail.',
        created_at: expect.any(String),
      },
    });
  });

  it('uses explicit resume_instruction over Slack auto-carry text', async () => {
    const fixture = await create_slack_fixture_with_user_message('Auto-carry this Slack message.');

    await fixture
      .tool('runtime-create_connection-1')
      ?.execute?.(
        { app_name: 'gmail', resume_instruction: 'Use this explicit resume instruction.' },
        context(fixture),
      );

    const connection = await fixture.db.query.connections.findFirst({
      where: (table, { eq }) => eq(table.app_id, 'app_gmail'),
    });
    expect(connection?.setup_state).toMatchObject({
      resume: {
        session_id: fixture.session.session_id,
        instruction: 'Use this explicit resume instruction.',
      },
    });
  });

  it('reuses the same pending setup link for repeated resume requests in one session', async () => {
    const fixture = await create_fixture();
    vi.stubGlobal('fetch', provider_api);
    await insert_connectable_app(fixture, {
      app_id: 'app_gmail',
      app_name: 'gmail',
      app_display_name: 'Gmail',
    });

    const first_result = await fixture.tool('runtime-create_connection-1')?.execute?.(
      {
        app_name: 'gmail',
        resume_instruction: 'Pull the latest five Gmail emails.',
      },
      context(fixture),
    );
    const second_result = await fixture.tool('runtime-create_connection-1')?.execute?.(
      {
        app_name: 'gmail',
        resume_instruction: 'Pull the latest ten Gmail emails.',
      },
      context(fixture),
    );
    const rows = await fixture.db.query.connections.findMany({
      where: (table, { eq }) => eq(table.app_id, 'app_gmail'),
    });

    if (!first_result?.ok || !second_result?.ok) {
      throw new Error('runtime-create_connection-1 should succeed');
    }
    expect(read_start_url(second_result.content_json)).toBe(
      read_start_url(first_result.content_json),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.setup_state).toMatchObject({
      resume: {
        session_id: fixture.session.session_id,
        instruction: 'Pull the latest ten Gmail emails.',
      },
    });
    expect(provider_api).not.toHaveBeenCalled();
  });

  it('reuses the same pending setup link for repeated connection-only requests in one session', async () => {
    const fixture = await create_fixture();
    vi.stubGlobal('fetch', provider_api);
    await insert_connectable_app(fixture, {
      app_id: 'app_gmail',
      app_name: 'gmail',
      app_display_name: 'Gmail',
    });

    const first_result = await fixture
      .tool('runtime-create_connection-1')
      ?.execute?.({ app_name: 'gmail' }, context(fixture));
    const second_result = await fixture
      .tool('runtime-create_connection-1')
      ?.execute?.({ app_name: 'gmail' }, context(fixture));
    const rows = await fixture.db.query.connections.findMany({
      where: (table, { eq }) => eq(table.app_id, 'app_gmail'),
    });

    if (!first_result?.ok || !second_result?.ok) {
      throw new Error('runtime-create_connection-1 should succeed');
    }
    expect(read_start_url(second_result.content_json)).toBe(
      read_start_url(first_result.content_json),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.setup_state).toMatchObject({
      setup_session_id: fixture.session.session_id,
    });
    expect(rows[0]?.setup_state).not.toHaveProperty('resume');
    expect(provider_api).not.toHaveBeenCalled();
  });
});

async function create_fixture(
  input: {
    source_context?: Parameters<typeof create_runtime_tool_definitions>[1]['source_context'];
  } = {},
) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  const tools = create_runtime_tool_definitions(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    ...(input.source_context ? { source_context: input.source_context } : {}),
  });

  return {
    db,
    bootstrap,
    session,
    run,
    tool: (name: string) => tools.find((tool) => tool.tool_name === name),
  };
}

async function create_slack_fixture_with_user_message(text: string) {
  const fixture = await create_fixture({
    source_context: {
      source_type: 'slack',
      source_metadata: {
        slack: {
          team_id: 'T123',
          channel_id: 'C123',
          thread_ts: '1700000000.000001',
          user_id: 'U123',
        },
      },
    },
  });
  await insert_connectable_app(fixture, {
    app_id: 'app_gmail',
    app_name: 'gmail',
    app_display_name: 'Gmail',
  });
  await create_run_message(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    message_role: 'user',
    message_content: { type: 'text', text },
    source_type: 'slack',
    actor_id: fixture.bootstrap.user_id,
  });
  return fixture;
}

async function insert_mcp_app_and_nodes(fixture: Awaited<ReturnType<typeof create_fixture>>) {
  await fixture.db.insert(apps).values({
    app_id: 'app_attio',
    app_name: 'attio',
    app_key: 'attio',
    catalog_scope: 'global',
    app_display_name: 'Attio',
    app_category: 'crm',
    auth_type: 'none',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: fixture.bootstrap.user_id,
    last_updated_by: fixture.bootstrap.user_id,
  });

  await fixture.db
    .insert(nodes)
    .values([
      mcp_node('node_attio_search_people', 'search_people', 'Search people', 'active', 'visible'),
      mcp_node('node_attio_list_notes', 'list_notes', 'List notes', 'active', 'visible'),
      mcp_node('node_attio_search_notes', 'search_notes', 'Search notes', 'active', 'visible'),
      mcp_node('node_attio_old_search', 'old_search', 'Old search', 'deprecated', 'hidden'),
      mcp_node(
        'node_attio_retired_search',
        'retired_search',
        'Retired search',
        'retired',
        'visible',
      ),
    ]);
}

async function insert_connectable_app(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  input: { app_id: string; app_name: string; app_display_name: string },
) {
  await fixture.db.insert(apps).values({
    app_id: input.app_id,
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: 'global',
    app_display_name: input.app_display_name,
    app_category: 'crm',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {
      description: `${input.app_display_name} CRM`,
      provider_configs: [
        {
          provider_key: 'composio',
          provider_config_key: `composio:${input.app_name}`,
          version: 1,
          status: 'active',
          provider_app_key: input.app_name,
          setup_defaults: {},
          connection_profiles: [
            {
              connection_profile_key: `composio:${input.app_name}:managed_oauth`,
              auth_method_key: 'composio_managed_auth',
              setup_strategy: { type: 'connect_token' },
              runtime_credential_strategy: { type: 'composio_account' },
              default_scopes: [],
              version: 1,
              status: 'active',
            },
          ],
        },
      ],
    },
    created_by: fixture.bootstrap.user_id,
    last_updated_by: fixture.bootstrap.user_id,
  });
}

function mcp_node(
  node_id: string,
  node_name: string,
  node_display_name: string,
  node_status: string,
  discovery_status: string,
): typeof nodes.$inferInsert {
  return {
    node_id,
    app_id: 'app_attio',
    app_key: 'attio',
    node_name,
    catalog_scope: 'global',
    node_key: `attio-${node_name}-1`,
    node_version: 1,
    node_display_name,
    node_kind: 'tool',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    output_schema: { type: 'object', additionalProperties: true },
    approval_policy: { mode: 'none' },
    runtime_handler: `mcp.attio.${node_name}`,
    node_runtime: 'mcp_tool',
    node_status,
    discovery_status,
    provider_key: 'mcp',
    provider_config_key: 'mcp:attio:first_party',
    provider_config_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: { mcp: { endpoint_url: mcp_server_url } },
    metadata: { description: node_display_name, required_connection: false },
    created_by: 'test',
    last_updated_by: 'test',
  };
}

function connection_row(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  connection_id: string,
  connection_status: string,
  health_status: string,
) {
  return {
    connection_id,
    workspace_id: fixture.bootstrap.workspace_id,
    app_id: 'app_attio',
    connection_key: `mcp:attio:${connection_id}`,
    connection_name: 'Attio',
    connection_status,
    provider_key: 'mcp',
    provider_config_key: 'mcp:attio:first_party',
    provider_config_version: 1,
    connection_profile_key: 'mcp:attio:first_party',
    connection_profile_version: 1,
    auth_method_key: 'mcp',
    external_account_id: connection_id,
    external_account_name: connection_id,
    authorized_scopes: [],
    health_status,
    created_by: fixture.bootstrap.user_id,
    last_updated_by: fixture.bootstrap.user_id,
  };
}

function context(fixture: Awaited<ReturnType<typeof create_fixture>>) {
  return {
    run_key: fixture.run.run_id,
    session_key: fixture.session.session_id,
    metadata: {},
  };
}

function read_start_url(content_json: unknown) {
  const value =
    typeof content_json === 'object' && content_json !== null && !Array.isArray(content_json)
      ? (content_json as Record<string, unknown>).start_url
      : null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('start_url missing');
  return value;
}
