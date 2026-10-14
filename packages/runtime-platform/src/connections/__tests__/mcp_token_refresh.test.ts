import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_workspace_mcp_catalog } from '@coworker/core/db/queries/mcp_catalog';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { connections, nodes } from '@coworker/core/db/schema';
import {
  encrypt_connection_credentials,
  read_connection_credential_value,
} from '@coworker/core/integrations/credential_envelope';
import { create_id, id_prefixes } from '@coworker/shared';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { execute_runtime_tool } from '@runtime-platform/tools/tool_execution_service';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

const server_url = 'https://mcp.acme.test/mcp';
const token_url = 'https://auth.acme.test/token';

type TokenAnswer = { status: number; body: Record<string, unknown> };

function stub_acme_mcp_and_auth_servers(input: {
  accepted_token: string;
  token_answer: TokenAnswer;
}) {
  const token_requests: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url) === token_url) {
        token_requests.push(new URLSearchParams(String(init?.body)));
        await new Promise((resolve) => setTimeout(resolve, 50));
        return Response.json(input.token_answer.body, { status: input.token_answer.status });
      }
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== `Bearer ${input.accepted_token}`) {
        return Response.json({ error: 'invalid_token' }, { status: 401 });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.method === 'initialize') {
        const serverInfo = { name: 'Acme', version: '1' };
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo },
        });
      }
      if (body.method === 'tools/call') {
        const content = [{ type: 'text', text: 'balance 10' }];
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { content } });
      }
      return new Response(null, { status: 202 });
    }),
  );
  return { token_requests };
}

async function create_fixture(credential_expiry_time: Date | null) {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const catalog = await create_workspace_mcp_catalog(db, {
    workspace_id: actor.workspace_id,
    server_key: 'acme',
    server_name: 'Acme',
    transport_config: { type: 'streamable_http', url: server_url },
    auth_config: { type: 'mcp_connection' },
    setup_strategy: {
      type: 'oauth2_authorization_code',
      authorization_url: 'https://auth.acme.test/authorize',
      token_url,
      client_id: 'acme-client',
      token_auth_method: 'none',
      resource: server_url,
      scopes: [],
      use_pkce: true,
    },
    tools: [{ tool_name: 'balance', display_name: 'Balance', input_schema: { type: 'object' } }],
    actor_id: actor.user_id,
  });
  const connection_id = create_id(id_prefixes.connection);
  await db.insert(connections).values({
    connection_id,
    workspace_id: actor.workspace_id,
    app_id: catalog.app_id,
    connection_key: `mcp:acme:${connection_id}`,
    connection_name: 'Acme',
    connection_status: 'active',
    provider_key: 'mcp',
    provider_config_key: 'mcp:acme:workspace',
    provider_config_version: 1,
    connection_profile_key: 'mcp:acme:workspace_credentials',
    connection_profile_version: 1,
    auth_method_key: 'mcp_workspace_credentials',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'stale-access', refresh_token: 'refresh-1' },
    }),
    credential_expiry_time,
    connection_config: {},
    health_status: 'healthy',
    created_by: actor.user_id,
    last_updated_by: actor.user_id,
  });
  const [node] = await db
    .update(nodes)
    .set({ node_config: { mcp: { endpoint_url: server_url } } })
    .where(eq(nodes.app_id, catalog.app_id))
    .returning({ node_key: nodes.node_key });
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  const call_balance = () =>
    execute_runtime_tool(db, {
      workspace_id: actor.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      agent_id: actor.agent_id,
      actor_id: actor.user_id,
      node_key: 'runtime-execute_tool-1',
      tool_input: { node_key: node?.node_key, input: {} },
    });
  const stored_connection = async () => {
    const [row] = await db
      .select()
      .from(connections)
      .where(eq(connections.connection_id, connection_id));
    return row;
  };
  return { call_balance, stored_connection };
}

const fresh_token: TokenAnswer = {
  status: 200,
  body: { access_token: 'fresh-access', refresh_token: 'refresh-2', expires_in: 3600 },
};

describe('an MCP connection whose OAuth access token runs out', () => {
  beforeEach(() => {
    process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'mcp-refresh-test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY;
  });

  it('trades the refresh token before the call and keeps the new pair', async () => {
    const fixture = await create_fixture(new Date(Date.now() - 60_000));
    const acme = stub_acme_mcp_and_auth_servers({
      accepted_token: 'fresh-access',
      token_answer: fresh_token,
    });

    const execution = await fixture.call_balance();

    expect(execution.result).toMatchObject({ success: true });
    expect(acme.token_requests).toHaveLength(1);
    const request = acme.token_requests[0];
    expect(request?.get('grant_type')).toBe('refresh_token');
    expect(request?.get('refresh_token')).toBe('refresh-1');
    expect(request?.get('client_id')).toBe('acme-client');
    expect(request?.get('resource')).toBe(server_url);
    const stored = await fixture.stored_connection();
    expect(read_connection_credential_value(stored?.credentials ?? null, 'refresh_token')).toBe(
      'refresh-2',
    );
    expect(stored?.credential_expiry_time?.getTime()).toBeGreaterThan(Date.now());
  });

  it('refreshes once and retries when the server refuses a token it thought was valid', async () => {
    const fixture = await create_fixture(new Date(Date.now() + 30 * 60_000));
    const acme = stub_acme_mcp_and_auth_servers({
      accepted_token: 'fresh-access',
      token_answer: fresh_token,
    });

    const execution = await fixture.call_balance();

    expect(execution.result).toMatchObject({ success: true });
    expect(acme.token_requests).toHaveLength(1);
  });

  it('spends the refresh token once when parallel calls find it expired', async () => {
    const fixture = await create_fixture(new Date(Date.now() - 60_000));
    const acme = stub_acme_mcp_and_auth_servers({
      accepted_token: 'fresh-access',
      token_answer: fresh_token,
    });

    const executions = await Promise.all([fixture.call_balance(), fixture.call_balance()]);

    expect(executions.map((execution) => execution.result.success)).toEqual([true, true]);
    expect(acme.token_requests).toHaveLength(1);
  });

  it('still asks for a reconnect when the refresh itself is refused', async () => {
    const fixture = await create_fixture(new Date(Date.now() - 60_000));
    stub_acme_mcp_and_auth_servers({
      accepted_token: 'fresh-access',
      token_answer: { status: 400, body: { error: 'invalid_grant' } },
    });

    const execution = await fixture.call_balance();

    expect(execution.result).toMatchObject({ error: { code: 'connection_expired' } });
  });
});
