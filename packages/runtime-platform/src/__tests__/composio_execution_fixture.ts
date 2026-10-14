import type { SessionEnv } from '@agent-core/environment';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { update_agent_enabled_nodes } from '@coworker/core/db/queries/connection_management';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import type { NodeInputSchemaData } from '@coworker/core/db/schema/json_column_types';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { vi } from 'vitest';

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

export type ComposioResponse = { status?: number; body: unknown };

export function stub_composio_api(routes: Array<{ path: string; respond: ComposioResponse }>) {
  const requests: RecordedRequest[] = [];
  const remaining = [...routes];

  const stubbed_fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const request_url = String(url);
    const body_text = typeof init?.body === 'string' ? init.body : null;
    requests.push({
      url: request_url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: body_text ? JSON.parse(body_text) : (init?.body ?? null),
    });

    const match_index = remaining.findIndex((route) => request_url.includes(route.path));
    if (match_index < 0) {
      throw new Error(`No stubbed Composio route for ${init?.method ?? 'GET'} ${request_url}`);
    }
    const [route] = remaining.splice(match_index, 1);
    const status = route?.respond.status ?? 200;
    return new Response(JSON.stringify(route?.respond.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', stubbed_fetch);
  return { requests, stubbed_fetch };
}

const composio_test_node_keys = [
  'attio-list_records-1',
  'attio-list_attachments-1',
  'attio-upload_attachment-1',
  'attio-post_api_proxy-1',
  'attio-trace_api_proxy-1',
  'attio-unslugged_action-1',
  'attio-new_record-1',
] as const;

export async function create_fixture(input: { environment?: SessionEnv } = {}) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Composio execution test',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });

  await db.insert(apps).values({
    app_id: 'app_attio_composio',
    app_name: 'attio',
    app_key: 'attio',
    catalog_scope: 'global',
    app_display_name: 'Attio',
    app_category: 'crm',
    auth_type: 'oauth2',
    app_status: 'active',
    allowed_request_origins: ['https://api.attio.com'],
    display_config: {},
    metadata: composio_app_metadata('attio'),
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
  const node_rows: Array<typeof nodes.$inferInsert> = [
    {
      ...composio_node(bootstrap.user_id, 'ATTIO_LIST_RECORDS'),
      node_id: 'node_attio_list_records',
      node_name: 'list_records',
      node_key: 'attio-list_records-1',
      node_display_name: 'List Attio records',
      input_schema: {
        type: 'object',
        properties: { object: { type: 'string' }, limit: { type: 'number' } },
        required: ['object'],
        additionalProperties: false,
      },
    },
    {
      ...composio_node(bootstrap.user_id, 'ATTIO_LIST_ATTACHMENTS'),
      node_id: 'node_attio_list_attachments',
      node_name: 'list_attachments',
      node_key: 'attio-list_attachments-1',
      node_display_name: 'List Attio attachments',
      input_schema: {
        type: 'object',
        properties: { record_id: { type: 'string' } },
        required: ['record_id'],
        additionalProperties: false,
      },
      output_schema: {
        type: 'object',
        properties: {
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: {
                  type: 'object',
                  file_downloadable: true,
                  properties: {
                    name: { type: 'string' },
                    s3url: { type: 'string' },
                    mimetype: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        additionalProperties: true,
      },
    },
    {
      ...composio_node(bootstrap.user_id, 'ATTIO_UPLOAD_ATTACHMENT'),
      node_id: 'node_attio_upload_attachment',
      node_name: 'upload_attachment',
      node_key: 'attio-upload_attachment-1',
      node_display_name: 'Upload an Attio attachment',
      input_schema: {
        type: 'object',
        properties: {
          record_id: { type: 'string' },
          attachment: {
            type: 'string',
            field: { file_reference: { accepted_sources: ['workspace_path', 'url'] } },
          },
        },
        required: ['record_id', 'attachment'],
        additionalProperties: false,
      },
    },
    {
      ...composio_node(bootstrap.user_id, 'composio:api_proxy:post'),
      node_id: 'node_attio_post_api_proxy',
      node_name: 'post_api_proxy',
      node_key: 'attio-post_api_proxy-1',
      node_display_name: 'POST API proxy request',
      runtime_handler: 'composio.api_proxy',
      input_schema: proxy_input_schema(),
      node_config: proxy_node_config('POST'),
      metadata: { source: 'composio', required_connection: true, proxy_method: 'post' },
    },
    {
      ...composio_node(bootstrap.user_id, 'composio:api_proxy:trace'),
      node_id: 'node_attio_trace_api_proxy',
      node_name: 'trace_api_proxy',
      node_key: 'attio-trace_api_proxy-1',
      node_display_name: 'TRACE API proxy request',
      runtime_handler: 'composio.api_proxy',
      input_schema: proxy_input_schema(),
      node_config: proxy_node_config('TRACE'),
      metadata: { source: 'composio', required_connection: true, proxy_method: 'trace' },
    },
    {
      ...composio_node(bootstrap.user_id, 'ATTIO_UNSLUGGED'),
      node_id: 'node_attio_unslugged_action',
      node_name: 'unslugged_action',
      node_key: 'attio-unslugged_action-1',
      node_display_name: 'Action without a Composio tool slug',
      node_config: { composio: { toolkit_slug: 'attio' } },
    },
    {
      ...composio_node(bootstrap.user_id, 'ATTIO_NEW_RECORD_TRIGGER'),
      node_id: 'node_attio_new_record_trigger',
      node_name: 'new_record',
      node_key: 'attio-new_record-1',
      node_display_name: 'New Attio record',
      node_kind: 'trigger',
      runtime_handler: 'composio.trigger.ATTIO_NEW_RECORD_TRIGGER',
    },
  ];
  await db.insert(nodes).values(node_rows);
  await update_agent_enabled_nodes(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    enabled_nodes: composio_test_node_keys.map((node_key) => ({
      node_key,
      provider_key: 'composio' as const,
      status: 'enabled' as const,
      connection_selector: { strategy: 'latest_active_matching_connection' as const },
      input_defaults: {},
      approval_policy_override: null,
    })),
  });

  const tools = create_runtime_tool_definitions(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    ...(input.environment ? { environment: input.environment } : {}),
  });
  const find_runtime_tool = (tool_name: string) => {
    const execute = tools.find((definition) => definition.tool_name === tool_name)?.execute;
    if (!execute) throw new Error(`${tool_name} was not registered`);
    return execute;
  };

  return {
    db,
    bootstrap,
    session,
    run,
    execute_tool: find_runtime_tool('runtime-execute_tool-1'),
    find_runtime_tool,
  };
}

export type ComposioFixture = Awaited<ReturnType<typeof create_fixture>>;

type RuntimeToolCallResult = Awaited<ReturnType<ComposioFixture['execute_tool']>>;

export function read_content_json(result: RuntimeToolCallResult) {
  if (!result.ok) throw new Error(`the tool call failed: ${result.error_code}`);
  return result.content_json;
}

export async function insert_attio_connection(
  fixture: ComposioFixture,
  overrides: Partial<typeof connections.$inferInsert> = {},
) {
  await fixture.db.insert(connections).values({
    connection_id: 'conn_attio_composio',
    workspace_id: fixture.bootstrap.workspace_id,
    app_id: 'app_attio_composio',
    connection_name: 'Attio test',
    connection_status: 'active',
    connection_key: 'composio:attio:conn_attio_composio',
    provider_key: 'composio',
    provider_config_key: 'composio:attio',
    provider_config_version: 1,
    connection_profile_key: 'composio:attio:oauth2',
    connection_profile_version: 1,
    auth_method_key: 'composio_managed_oauth',
    external_user_key: 'ws_external_attio',
    external_account_id: 'ca_test',
    external_account_name: 'Attio workspace',
    authorized_scopes: [],
    health_status: 'healthy',
    provider_account: {
      connected_account_id: 'ca_test',
      auth_config_id: 'ac_test',
      auth_scheme: 'OAUTH2',
      toolkit_slug: 'attio',
    },
    metadata: { provider: 'composio' },
    created_by: fixture.bootstrap.user_id,
    last_updated_by: fixture.bootstrap.user_id,
    ...overrides,
  });
}

export function tool_context(fixture: ComposioFixture) {
  return {
    run_key: fixture.run.run_id,
    session_key: fixture.session.session_id,
    metadata: {},
  };
}

function proxy_input_schema(): NodeInputSchemaData {
  return {
    type: 'object',
    properties: {
      url: { type: 'string' },
      body: { type: 'object', additionalProperties: true },
      query_parameters: { type: 'object', additionalProperties: true },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
    },
    required: ['url'],
    additionalProperties: false,
  };
}

function proxy_node_config(method: string) {
  return {
    sourced_from: composio_sourced_from(`composio:api_proxy:${method.toLowerCase()}`),
    composio: { toolkit_slug: 'attio' },
    proxy: {
      method,
      url_mode: 'static_domain',
      base_proxy_target_url: 'https://api.attio.com',
    },
  };
}

function composio_node(
  actor_id: string,
  provider_component_id: string,
): Omit<typeof nodes.$inferInsert, 'node_id' | 'node_key' | 'node_display_name' | 'node_name'> {
  return {
    app_id: 'app_attio_composio',
    app_key: 'attio',
    catalog_scope: 'global' as const,
    node_version: 1,
    node_kind: 'action',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    output_schema: { type: 'object', additionalProperties: true },
    approval_policy: { mode: 'none' },
    runtime_handler: `composio.${provider_component_id}`,
    node_runtime: 'connected_app',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'composio',
    provider_config_key: 'composio:attio',
    provider_config_version: 1,
    connection_profile_key: 'composio:attio:oauth2',
    connection_profile_version: 1,
    required_scopes: [],
    required_account_properties: [],
    node_config: {
      sourced_from: composio_sourced_from(provider_component_id),
      composio: { toolkit_slug: 'attio', tool_slug: provider_component_id },
    },
    metadata: { source: 'composio', required_connection: true },
    created_by: actor_id,
    last_updated_by: actor_id,
  };
}

function composio_sourced_from(provider_component_id: string) {
  return {
    provider: 'composio',
    provider_app_id: 'attio',
    provider_component_id,
    provider_component_version: 'latest',
  };
}

function composio_app_metadata(toolkit_slug: string) {
  return {
    source: 'composio',
    sourced_from: {
      provider: 'composio',
      provider_app_id: toolkit_slug,
      provider_app_slug: toolkit_slug,
    },
    provider_configs: [
      {
        provider_key: 'composio',
        provider_config_key: `composio:${toolkit_slug}`,
        version: 1,
        status: 'active',
        provider_app_key: toolkit_slug,
        setup_defaults: {},
        connection_profiles: [
          {
            connection_profile_key: `composio:${toolkit_slug}:oauth2`,
            version: 1,
            status: 'active',
            auth_method_key: 'composio_managed_oauth',
            setup_strategy: {
              type: 'hosted_connect_link',
              auth_scheme: 'OAUTH2',
              auth_config_source: 'composio_managed',
              connected_account_fields: [],
            },
            runtime_credential_strategy: {
              type: 'provider_account_reference',
              send_to_provider_as: 'connected_account_id',
            },
            default_scopes: [],
          },
        ],
      },
    ],
  };
}
