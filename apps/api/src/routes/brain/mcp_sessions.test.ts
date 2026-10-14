import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_app } from '@api/app';
import { max_open_long_polls_per_api_key } from '@api/lib/api_key_long_poll';
import { hold_a_tool_call_for_approval } from '@api/routes/__tests__/held_tool_call_fixture';
import {
  max_session_wait_seconds,
  wait_for_idle_api_session,
} from '@api/services/sessions_api/session_wait';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKey,
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_file } from '@coworker/core/db/queries/files';
import {
  acquire_session_execution_lock,
  create_tool_call_started,
  list_session_runs,
} from '@coworker/core/db/queries/sessions';
import { apps, connections } from '@coworker/core/db/schema';
import { run_queue_jobs } from '@coworker/jobs';
import { create_id, id_prefixes } from '@coworker/shared';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/mcp-sessions-test',
    async *run() {
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'The payouts are in.' }] },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({ provider: 'openai', model_name: 'gpt-test', reasoning_level: 'medium' }),
}));

type App = ReturnType<typeof create_app>;
type JsonRpcResponse = {
  result?: { content?: { type: string; text: string }[]; isError?: boolean; tools?: unknown[] };
};

const session_tool_names = [
  'list_agents',
  'create_session',
  'send_message',
  'wait_for_session',
  'get_session',
  'confirm_tool',
  'list_session_files',
];

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;
let next_request_id = 0;

async function mint_key(
  scopes: ApiKeyScope[] = ['agents.read', 'sessions.read', 'sessions.write'],
  key_audience: ApiKeyAudience = 'internal',
): Promise<{ api_key: ApiKey; secret: string }> {
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
  return { response, body: (await response.json()) as JsonRpcResponse };
}

async function call_tool(secret: string, name: string, tool_arguments: unknown = {}) {
  const { body } = await call_mcp(secret, 'tools/call', { name, arguments: tool_arguments });
  const text = body?.result?.content?.at(0)?.text ?? '';
  return { is_error: body?.result?.isError ?? false, payload: JSON.parse(text) as never };
}

async function list_tool_names(secret: string) {
  const { body } = await call_mcp(secret, 'tools/list');
  return ((body?.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name);
}

const session_fields_over_mcp = ['agent', 'metadata', 'session_id', 'status', 'title'];

function sorted_keys(payload: object) {
  return Object.keys(payload).sort();
}

async function record_a_session_file(session_id: string) {
  const [run] = await list_session_runs(db, workspace_id, session_id);
  return create_file(db, {
    workspace_id,
    session_id,
    run_id: run?.run_id ?? null,
    file_purpose: 'output',
    storage_provider: 'object_store',
    storage_key: `${workspace_id}/payouts.csv`,
    file_name: 'payouts.csv',
    mime_type: 'text/csv',
    byte_size: 42,
    actor_id,
  });
}

async function seed_an_active_connection() {
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'payments_app',
    app_key: 'payments_app',
    catalog_scope: 'global',
    app_display_name: 'Payments',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(connections).values({
    connection_id: create_id(id_prefixes.connection),
    workspace_id,
    app_id,
    connection_key: 'native:payments_app:main',
    connection_name: 'Payments prod',
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:payments_app',
    provider_config_version: 1,
    auth_method_key: 'oauth2',
    health_status: 'healthy',
    connection_config: { access: { type: 'shared' } },
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

async function run_queued_session_jobs(session_id: string) {
  await run_queue_jobs(
    db,
    { workspace_id, queue_key: `session:${session_id}` },
    find_event_job_handler,
  );
}

describe('sessions over MCP', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('hides every session tool from a key that carries no session scope', async () => {
    const { secret } = await mint_key(['memory.read']);

    const offered = await list_tool_names(secret);

    for (const tool_name of session_tool_names) expect(offered).not.toContain(tool_name);
  });

  it('offers the read tools to a read key, and every session tool to a write key', async () => {
    const read_only = await mint_key(['sessions.read']);
    const write_only = await mint_key(['sessions.write']);

    expect(await list_tool_names(read_only.secret)).toEqual([
      'whoami',
      'wait_for_session',
      'get_session',
      'list_session_files',
    ]);
    expect(await list_tool_names(write_only.secret)).toEqual([
      'whoami',
      'create_session',
      'send_message',
      'wait_for_session',
      'get_session',
      'confirm_tool',
      'list_session_files',
    ]);
  });

  it('refuses the session tools to an external-audience key', async () => {
    const { secret } = await mint_key(['sessions.write'], 'external');

    const { is_error, payload } = await call_tool(secret, 'create_session', {});

    expect(is_error).toBe(true);
    expect(payload).toMatchObject({ error: 'scope_missing', http_status: 403 });
  });

  it('hides the session tools from an external-audience key that holds their scopes', async () => {
    const { secret } = await mint_key(
      ['agents.read', 'sessions.read', 'sessions.write', 'memory.read'],
      'external',
    );

    const offered = await list_tool_names(secret);

    for (const tool_name of session_tool_names) expect(offered).not.toContain(tool_name);
  });

  it('opens a session with its first message, waits for it, and reads back what was said', async () => {
    const { secret } = await mint_key();

    const opened = await call_tool(secret, 'create_session', {
      title: 'Nightly report',
      message: 'Summarize yesterday.',
    });
    const session = opened.payload as unknown as { session_id: string; status: string };

    expect(opened.is_error).toBe(false);
    expect(session.status).toBe('running');
    expect(session.session_id).toEqual(expect.any(String));
    expect(sorted_keys(session)).toEqual(session_fields_over_mcp);
    expect(opened.payload).toMatchObject({ agent: { slug: 'main' } });
    expect(sorted_keys((opened.payload as { agent: object }).agent)).toEqual(['name', 'slug']);

    const timed_out = await call_tool(secret, 'wait_for_session', {
      session_id: session.session_id,
      timeout_seconds: 0,
    });
    expect(timed_out.payload).toEqual({ wait_timed_out: true, session_id: session.session_id });

    await run_queued_session_jobs(session.session_id);

    const waited = await call_tool(secret, 'wait_for_session', {
      session_id: session.session_id,
      timeout_seconds: 30,
    });
    const idle = waited.payload as unknown as { status: string; last_agent_message: string };
    expect(idle.status).toBe('idle');
    expect(idle.last_agent_message).toBe('The payouts are in.');
    expect(sorted_keys(idle)).toEqual([...session_fields_over_mcp, 'last_agent_message'].sort());

    const read = await call_tool(secret, 'get_session', { session_id: session.session_id });
    expect(read.payload).toMatchObject({
      session_id: session.session_id,
      status: 'idle',
      title: 'Nightly report',
      last_agent_message: 'The payouts are in.',
    });
    expect(sorted_keys(read.payload)).toEqual(sorted_keys(idle));

    await record_a_session_file(session.session_id);
    const files = await call_tool(secret, 'list_session_files', {
      session_id: session.session_id,
    });
    expect(files.payload).toEqual({
      files: [{ filename: 'payouts.csv', mime_type: 'text/csv', size_bytes: 42 }],
      open_in_alfera: expect.stringMatching(new RegExp(`/chats/${session.session_id}$`)),
    });
    expect(JSON.stringify(files.payload)).not.toContain('/v1/');
  });

  it('lists the workspace agents a session can be opened with', async () => {
    const { secret } = await mint_key();

    const { is_error, payload } = await call_tool(secret, 'list_agents');
    const agents = payload as unknown as { slug: string }[];

    expect(is_error).toBe(false);
    expect(agents.map((agent) => agent.slug)).toContain('main');
    expect(Object.keys(agents[0] ?? {}).sort()).toEqual(['description', 'name', 'slug']);
  });

  it('sends the next message, and refuses one while the session is still working', async () => {
    const { secret, api_key } = await mint_key();
    const opened = await call_tool(secret, 'create_session', { message: 'Summarize yesterday.' });
    const session_id = (opened.payload as unknown as { session_id: string }).session_id;
    await run_queued_session_jobs(session_id);

    const accepted = await call_tool(secret, 'send_message', {
      session_id,
      message: 'And the week before?',
    });
    expect(accepted.is_error).toBe(false);
    expect(accepted.payload).toEqual({ accepted_event_count: 1 });
    await run_queued_session_jobs(session_id);
    expect(await list_session_runs(db, workspace_id, session_id)).toHaveLength(2);

    await acquire_session_execution_lock(db, {
      workspace_id,
      session_id,
      run_id: 'run_locked',
      lease_ms: 60_000,
      actor_id: api_key.api_key_id,
    });
    const while_running = await call_tool(secret, 'send_message', {
      session_id,
      message: 'Actually, stop.',
    });
    expect(while_running.is_error).toBe(true);
    expect(while_running.payload).toMatchObject({
      error: 'conversation_busy',
      http_status: 409,
    });
  });

  it('answers a session it did not open with not_found, never a refusal', async () => {
    const { secret: owner_secret } = await mint_key();
    const { secret: other_secret } = await mint_key();
    const opened = await call_tool(owner_secret, 'create_session', {});
    const session_id = (opened.payload as unknown as { session_id: string }).session_id;

    const read = await call_tool(other_secret, 'get_session', { session_id });

    expect(read.is_error).toBe(true);
    expect(read.payload).toMatchObject({ error: 'not_found', http_status: 404 });
  });

  it('shows the action a session holds for approval, and answers it with confirm_tool', async () => {
    const { secret } = await mint_key();
    const opened = await call_tool(secret, 'create_session', { message: 'Email the supplier.' });
    const session: { session_id: string } = opened.payload;
    const session_id = session.session_id;
    await run_queued_session_jobs(session_id);
    const held = await hold_a_tool_call_for_approval(db, { workspace_id, session_id, actor_id });

    const waited = await call_tool(secret, 'wait_for_session', { session_id, timeout_seconds: 5 });
    const stopped: { status: string; waiting_for_approval: { input_preview: string }[] } =
      waited.payload;
    expect(waited.is_error).toBe(false);
    expect(stopped).toMatchObject({
      status: 'waiting_for_approval',
      waiting_for_approval: [
        { tool_use_id: held.tool_call_id, tool: 'gmail-send_email-1', question: null },
      ],
    });
    expect(stopped.waiting_for_approval.at(0)?.input_preview).toContain('someone@example.com');

    const read = await call_tool(secret, 'get_session', { session_id });
    expect(read.payload).toMatchObject({ status: 'waiting_for_approval' });

    const answered = await call_tool(secret, 'confirm_tool', {
      session_id,
      tool_use_id: held.tool_call_id,
      result: 'deny',
      deny_message: 'Not this supplier.',
    });
    expect(answered.is_error).toBe(false);

    const after = await call_tool(secret, 'get_session', { session_id });
    const settled: { status: string } = after.payload;
    expect(settled).not.toHaveProperty('waiting_for_approval');
    expect(settled.status).not.toBe('waiting_for_approval');
  });

  it('refuses a confirmation for a tool use nobody is waiting on', async () => {
    const { secret } = await mint_key();
    const opened = await call_tool(secret, 'create_session', { message: 'Summarize yesterday.' });
    const session_id = (opened.payload as unknown as { session_id: string }).session_id;
    await run_queued_session_jobs(session_id);
    const [run] = await list_session_runs(db, workspace_id, session_id);
    const tool_call = await create_tool_call_started(db, {
      workspace_id,
      session_id,
      run_id: run?.run_id ?? '',
      node_id: null,
      node_version: null,
      tool_name: 'runtime-execute_tool-1',
      tool_input: {},
      tool_status: 'completed',
      idempotency_key: `${run?.run_id}:free-call`,
      actor_id,
    });

    const confirmed = await call_tool(secret, 'confirm_tool', {
      session_id,
      tool_use_id: tool_call.tool_call_id,
      result: 'allow',
    });

    expect(confirmed.is_error).toBe(true);
    expect(confirmed.payload).toMatchObject({
      error: 'event_not_sendable',
      http_status: 422,
    });
  });

  describe('a held wait_for_session', () => {
    async function open_running_session(secret: string, api_key: ApiKey) {
      const opened = await call_tool(secret, 'create_session', {});
      const session_id = (opened.payload as unknown as { session_id: string }).session_id;
      await acquire_session_execution_lock(db, {
        workspace_id,
        session_id,
        run_id: 'run_still_working',
        lease_ms: 3_600_000,
        actor_id: api_key.api_key_id,
      });
      return session_id;
    }

    async function start_wait(secret: string, session_id: string, signal?: AbortSignal) {
      next_request_id += 1;
      const response = await app.request('/v1/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: next_request_id,
          method: 'tools/call',
          params: { name: 'wait_for_session', arguments: { session_id, timeout_seconds: 120 } },
        }),
        ...(signal ? { signal } : {}),
      });
      const body = (await response.json()) as JsonRpcResponse;
      return JSON.parse(body.result?.content?.at(0)?.text ?? 'null') as Record<string, unknown>;
    }

    it('stops the moment the client hangs up instead of polling to the deadline', async () => {
      const { secret, api_key } = await mint_key();
      const session_id = await open_running_session(secret, api_key);
      const hang_up = new AbortController();

      const started = Date.now();
      const waiting = start_wait(secret, session_id, hang_up.signal);
      setTimeout(() => hang_up.abort(), 300);

      expect(await waiting).toEqual({ wait_timed_out: true, session_id });
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('ends with api_key_revoked when the key is revoked mid-wait', async () => {
      const { secret, api_key } = await mint_key();
      const session_id = await open_running_session(secret, api_key);

      const waiting = start_wait(secret, session_id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await revoke_api_key(db, { workspace_id, api_key_id: api_key.api_key_id, actor_id });

      expect(await waiting).toMatchObject({ error: 'api_key_revoked', http_status: 401 });
    });

    it('refuses one wait past the per-key ceiling, and frees the slot when a wait ends', async () => {
      const { secret, api_key } = await mint_key();
      const session_id = await open_running_session(secret, api_key);
      const hang_ups = Array.from(
        { length: max_open_long_polls_per_api_key },
        () => new AbortController(),
      );
      const held = hang_ups.map((hang_up) => start_wait(secret, session_id, hang_up.signal));
      await new Promise((resolve) => setTimeout(resolve, 300));

      const one_too_many = await start_wait(secret, session_id);
      expect(one_too_many).toMatchObject({ error: 'too_many_open_streams', http_status: 429 });

      for (const hang_up of hang_ups) hang_up.abort();
      await Promise.all(held);
      const after = await call_tool(secret, 'wait_for_session', { session_id, timeout_seconds: 0 });
      expect(after.payload).toEqual({ wait_timed_out: true, session_id });
    });

    it('never holds a wait past max_session_wait_seconds, whatever the caller asked', async () => {
      const { secret, api_key } = await mint_key();
      const session_id = await open_running_session(secret, api_key);
      const real_now = Date.now.bind(Date);
      const started = real_now();
      vi.spyOn(Date, 'now').mockImplementation(() =>
        real_now() - started > 50 ? real_now() + (max_session_wait_seconds + 1) * 1000 : real_now(),
      );

      const result = await wait_for_idle_api_session(db, api_key, {
        session_id,
        timeout_seconds: 300,
        signal: new AbortController().signal,
      });

      vi.restoreAllMocks();
      expect(result).toEqual({ wait_timed_out: true, session_id });
      expect(real_now() - started).toBeLessThan(5_000);
    });
  });
});

describe('workspace tools over MCP', () => {
  const workspace_tool_names = ['list_integrations', 'list_skills'];
  const workspace_scopes: ApiKeyScope[] = ['integrations.read', 'skills.read'];

  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('offers the workspace tools to an internal key with their scopes, and none to an external one', async () => {
    const internal = await mint_key(workspace_scopes);
    const external = await mint_key(workspace_scopes, 'external');

    const offered = await list_tool_names(internal.secret);
    const offered_outside = await list_tool_names(external.secret);
    const who = await call_tool(internal.secret, 'whoami');

    expect(offered).toContain('whoami');
    for (const tool_name of workspace_tool_names) expect(offered).toContain(tool_name);
    for (const tool_name of workspace_tool_names) expect(offered_outside).not.toContain(tool_name);
    expect(who.payload).toMatchObject({ tool_names: offered });
  });

  it('reads integrations and skills', async () => {
    const { secret } = await mint_key(workspace_scopes);
    await seed_an_active_connection();

    const integrations = await call_tool(secret, 'list_integrations');
    const skills = await call_tool(secret, 'list_skills');

    expect(integrations.payload).toEqual([
      { name: 'Payments prod', kind: 'native', tool_count: 0 },
    ]);
    expect((skills.payload as unknown as { source: string }[]).at(0)?.source).toBe('platform');
  });
});
