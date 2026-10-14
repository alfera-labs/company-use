import { create_app } from '@api/app';
import { brain_mcp_tools } from '@api/routes/brain/mcp_tools';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import {
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';
import { apps, connections } from '@coworker/core/db/schema';
import { find_alfera_api_tool } from '@coworker/core/integrations/alfera_api_tools';
import { create_id, id_prefixes } from '@coworker/shared';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;
type JsonRpcResponse = {
  jsonrpc: string;
  id: string | number | null;
  result?: {
    content?: { type: string; text: string }[];
    isError?: boolean;
    tools?: { name: string; title: string; annotations: unknown }[];
    protocolVersion?: string;
    serverInfo?: { name: string };
  };
  error?: { code: number | string; message: string };
};

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;
let next_request_id = 0;

async function mint_key(scopes: ApiKeyScope[], key_audience: ApiKeyAudience = 'internal') {
  return create_api_key(db, {
    workspace_id,
    key_name: `${scopes.join('+')} key`,
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
}

async function call_mcp(secret: string, method: string, params?: unknown) {
  next_request_id += 1;
  const response = await app.request('/v1/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: next_request_id,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
  const body = response.status === 202 ? null : ((await response.json()) as JsonRpcResponse);
  return { response, body };
}

async function call_tool(secret: string, name: string, tool_arguments: unknown = {}) {
  const { body } = await call_mcp(secret, 'tools/call', { name, arguments: tool_arguments });
  const payload: unknown = JSON.parse(body?.result?.content?.at(0)?.text ?? '');
  return { is_error: body?.result?.isError ?? false, payload };
}

async function put_policy(policy: {
  scope_type: string;
  scope_id: string;
  resource_type: string;
  resource_id: string;
  policy_mode: string;
}) {
  const response = await app.request('/v1/policies', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(policy),
  });
  expect(response.status).toBe(200);
}

async function set_api_tool_rule(tool_name: string, policy_mode: string) {
  const connection = await find_or_create_alfera_api_connection(db, workspace_id);
  await put_policy({
    scope_type: 'connection',
    scope_id: connection.connection_id,
    resource_type: 'node',
    resource_id: `alfera_api-${tool_name}-1`,
    policy_mode,
  });
  return connection.connection_id;
}

const reads_only = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const starts_agent_work = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

const expected_tool_hints: Record<string, typeof reads_only> = {
  whoami: reads_only,
  list_agents: reads_only,
  create_session: starts_agent_work,
  send_message: starts_agent_work,
  wait_for_session: reads_only,
  get_session: reads_only,
  confirm_tool: starts_agent_work,
  list_session_files: reads_only,
  list_integrations: reads_only,
  list_skills: reads_only,
};

const every_tool_scope: ApiKeyScope[] = [
  'agents.read',
  'sessions.write',
  'skills.read',
  'integrations.read',
];

async function connect_a_payments_app() {
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'payments_app',
    app_key: 'payments_app',
    catalog_scope: 'global',
    app_display_name: 'Payments',
    auth_type: 'oauth2',
    app_status: 'active',
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  const connection_id = create_id(id_prefixes.connection);
  await db.insert(connections).values({
    connection_id,
    workspace_id,
    app_id,
    connection_key: 'native:payments_app:main',
    connection_name: 'Payments prod',
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:payments_app',
    auth_method_key: 'oauth2',
    health_status: 'healthy',
    connection_config: { access: { type: 'shared' } },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  return connection_id;
}

async function list_tool_names(secret: string) {
  const { body } = await call_mcp(secret, 'tools/list');
  return (body?.result?.tools ?? []).map((tool) => tool.name);
}

describe('MCP surface of the open copy', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('advertises only the tools a key’s scopes allow', async () => {
    const { secret } = await mint_key(['sessions.read']);

    expect(await list_tool_names(secret)).toEqual([
      'whoami',
      'wait_for_session',
      'get_session',
      'list_session_files',
    ]);
  });

  it('lists every tool with its catalog title and the three review hints', async () => {
    const { secret } = await mint_key(every_tool_scope);
    const { body } = await call_mcp(secret, 'tools/list');
    const tools = body?.result?.tools ?? [];

    expect(tools.map((tool) => tool.name)).toEqual([
      'whoami',
      'list_agents',
      'create_session',
      'send_message',
      'wait_for_session',
      'get_session',
      'confirm_tool',
      'list_session_files',
      'list_integrations',
      'list_skills',
    ]);
    expect(Object.keys(brain_mcp_tools).sort()).toEqual(Object.keys(expected_tool_hints).sort());
    for (const tool of tools) {
      expect(tool.title).toBe(find_alfera_api_tool(tool.name)?.display_name);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.title.length).toBeLessThanOrEqual(40);
      expect({ [tool.name]: tool.annotations }).toEqual({
        [tool.name]: expected_tool_hints[tool.name],
      });
    }
  });

  it('answers whoami with the workspace name, key name, and callable tools, and no internal id', async () => {
    const { api_key, secret } = await mint_key(['skills.read'], 'external');
    const workspace = await find_workspace_profile(db, workspace_id);

    const { is_error, payload } = await call_tool(secret, 'whoami');
    const wider = await mint_key(['sessions.read', 'integrations.read']);
    const wider_whoami = await call_tool(wider.secret, 'whoami');

    expect(is_error).toBe(false);
    expect(workspace?.workspace_name).toEqual(expect.any(String));
    expect(payload).toEqual({
      workspace_name: workspace?.workspace_name,
      key_name: api_key.key_name,
      tool_names: ['whoami'],
    });
    expect(wider_whoami.payload).toMatchObject({
      tool_names: [
        'whoami',
        'wait_for_session',
        'get_session',
        'list_session_files',
        'list_integrations',
      ],
    });
    expect(await list_tool_names(secret)).toEqual(['whoami']);
    const skills = await call_tool(secret, 'list_skills', {});
    expect(skills.is_error).toBe(true);
    expect(skills.payload).toEqual({
      error: 'scope_missing',
      message: "The 'skills.read' scope is only available to internal-audience API keys",
      http_status: 403,
    });
  });

  it('returns what the REST route returns for the same list, without the internal key', async () => {
    const connection_id = await connect_a_payments_app();
    const { secret } = await mint_key(['integrations.read']);

    const rest = await app.request('/v1/integrations', {
      headers: { authorization: `Bearer ${secret}` },
    });
    const { is_error, payload } = await call_tool(secret, 'list_integrations');

    expect(is_error).toBe(false);
    expect(await rest.json()).toEqual({
      data: [
        { integration_key: connection_id, name: 'Payments prod', kind: 'native', tool_count: 0 },
      ],
    });
    expect(payload).toEqual([{ name: 'Payments prod', kind: 'native', tool_count: 0 }]);
  });

  it('refuses a tool the key has no scope for, as a tool error the agent can read', async () => {
    const { secret } = await mint_key(['skills.read']);

    const { is_error, payload } = await call_tool(secret, 'list_integrations');

    expect(is_error).toBe(true);
    expect(payload).toEqual({
      error: 'scope_missing',
      message: "This API key is missing the 'integrations.read' scope",
      http_status: 403,
    });
  });

  it('refuses a tool its connection sets to Never allow, and only that tool', async () => {
    const { secret } = await mint_key(['integrations.read', 'skills.read']);
    const connection_id = await set_api_tool_rule('list_integrations', 'never');

    const blocked = await call_tool(secret, 'list_integrations');
    const other = await call_tool(secret, 'list_skills', {});

    expect(blocked.is_error).toBe(true);
    expect(blocked.payload).toMatchObject({
      error: 'tool_blocked_by_workspace_policy',
      message: expect.stringContaining("Never allow by the Alfera API connection's rule"),
      http_status: 403,
    });
    expect(other.is_error).toBe(false);
    expect(connection_id).toMatch(/^conn_/);
  });

  it('refuses an Ask tool as needing approval, because a key call has nobody to ask', async () => {
    const { secret } = await mint_key(['integrations.read']);
    await set_api_tool_rule('list_integrations', 'ask');

    const { is_error, payload } = await call_tool(secret, 'list_integrations');

    expect(is_error).toBe(true);
    expect(payload).toMatchObject({ error: 'approval_required', http_status: 403 });
  });

  it('applies a workspace rule about tools that change data to the write tools only', async () => {
    const { secret } = await mint_key(['agents.read', 'sessions.write']);
    await put_policy({
      scope_type: 'workspace',
      scope_id: workspace_id,
      resource_type: 'node_label',
      resource_id: 'changes_things',
      policy_mode: 'never',
    });

    const write = await call_tool(secret, 'create_session', { message: 'Count the invoices.' });
    const read = await call_tool(secret, 'list_agents');

    expect(write.is_error).toBe(true);
    expect(write.payload).toMatchObject({
      error: 'tool_blocked_by_workspace_policy',
      message: expect.stringContaining('by a workspace rule'),
    });
    expect(read.is_error).toBe(false);
  });

  it('governs every MCP tool as a node of the built-in Alfera API connection', () => {
    expect(Object.keys(brain_mcp_tools)).toHaveLength(10);
    const ungoverned = Object.keys(brain_mcp_tools).filter((name) => !find_alfera_api_tool(name));
    expect(ungoverned).toEqual([]);
  });

  it('answers the pre-rename tool name without listing it, under the new name’s policy', async () => {
    const { secret } = await mint_key(['sessions.read']);
    const not_this_keys = { session_id: 'ses_not_this_keys', timeout_seconds: 0 };

    expect(await list_tool_names(secret)).not.toContain('wait_for_session_idle');

    const waited = await call_tool(secret, 'wait_for_session_idle', not_this_keys);
    expect(waited.payload).toMatchObject({ error: 'not_found', http_status: 404 });
    expect(waited).toEqual(await call_tool(secret, 'wait_for_session', not_this_keys));

    await set_api_tool_rule('wait_for_session', 'never');
    const blocked = await call_tool(secret, 'wait_for_session_idle', not_this_keys);
    expect(blocked.payload).toMatchObject({ error: 'tool_blocked_by_workspace_policy' });
  });

  it('answers the retired teach_memory as not in this edition, unlisted', async () => {
    const { secret } = await mint_key(['memory.write'], 'external');

    const taught = await call_tool(secret, 'teach_memory', { facts: [] });
    expect(taught).toEqual({
      is_error: true,
      payload: {
        error: 'not_in_this_edition',
        message: 'This feature runs on Alfera Cloud.',
        http_status: 404,
      },
    });
    expect(await list_tool_names(secret)).toEqual(['whoami']);
  });

  it('answers a tool name this edition does not hold, and a real unknown name, as unknown', async () => {
    const { secret } = await mint_key(every_tool_scope);

    for (const name of ['search_memory', 'ask_worker', 'no_such_tool', 'constructor', 'toString']) {
      const { body } = await call_mcp(secret, 'tools/call', { name, arguments: {} });
      expect(body?.error).toMatchObject({ code: -32602, message: `Unknown tool: ${name}` });
    }
  });

  it('rejects a revoked key with plain HTTP 401, on every MCP method', async () => {
    const { api_key, secret } = await mint_key(['sessions.read']);
    await revoke_api_key(db, { workspace_id, api_key_id: api_key.api_key_id, actor_id });

    for (const method of ['initialize', 'tools/list', 'tools/call']) {
      const { response, body } = await call_mcp(secret, method, { name: 'whoami' });
      expect(response.status).toBe(401);
      expect(body?.error?.code).toBe('api_key_revoked');
    }
  });

  it('rejects an unknown method and a malformed message as JSON-RPC errors', async () => {
    const { secret } = await mint_key(['sessions.read']);

    const unknown = await call_mcp(secret, 'resources/list');
    expect(unknown.response.status).toBe(200);
    expect(unknown.body?.error?.code).toBe(-32601);

    const malformed = await app.request('/v1/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]),
    });
    const malformed_body = (await malformed.json()) as JsonRpcResponse;
    expect(malformed.status).toBe(400);
    expect(malformed_body.error?.code).toBe(-32600);
  });

  it('acknowledges the initialize handshake and its notification', async () => {
    const { secret } = await mint_key(['sessions.read']);

    const initialized = await call_mcp(secret, 'initialize', { protocolVersion: '2025-03-26' });
    expect(initialized.body?.result).toMatchObject({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'alfera-brain' },
    });

    const acknowledged = await app.request('/v1/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(acknowledged.status).toBe(202);
    expect(acknowledged.headers.get('mcp-session-id')).toBeNull();
  });
});
