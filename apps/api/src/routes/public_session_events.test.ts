import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_app } from '@api/app';
import { max_open_long_polls_per_api_key } from '@api/lib/api_key_long_poll';
import { hold_a_tool_call_for_approval as hold_a_tool_call } from '@api/routes/__tests__/held_tool_call_fixture';
import { max_session_event_stream_lifetime_ms } from '@api/services/sessions_api/session_event_stream';
import { get_api_session_snapshot } from '@api/services/sessions_api/session_reads';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKey,
  type ApiKeyScope,
  create_api_key,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  get_tool_policy_wait,
  list_tool_policy_waits,
} from '@coworker/core/db/queries/event_waits';
import { set_policy } from '@coworker/core/db/queries/policies';
import { find_run_wait } from '@coworker/core/db/queries/run_suspension';
import {
  acquire_session_execution_lock,
  create_run_event,
  create_tool_call_started,
  list_run_messages,
  list_run_tool_calls,
  list_session_runs,
} from '@coworker/core/db/queries/sessions';
import { run_queue_jobs } from '@coworker/jobs';
import { sleep } from '@coworker/shared';
import {
  create_tool_call_completed_chat_event_draft,
  create_tool_call_started_chat_event_draft,
  record_chat_stream_event_drafts,
} from '@runtime-platform/chat_stream/chat_stream_events';
import { public_run_failure_message } from '@runtime-platform/chat_stream/public_run_output';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_tool_batch_policy } from '@runtime-platform/tools/policies/tool_batch_policy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine_behaviour = vi.hoisted(() => ({ fails: false }));

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/session-events-test',
    async *run() {
      if (engine_behaviour.fails) throw new Error('provider said 502: upstream_pool_exhausted');
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({ provider: 'openai', model_name: 'gpt-test', reasoning_level: 'medium' }),
}));

type App = ReturnType<typeof create_app>;
type PublicSessionEvent = {
  id: string;
  type: string;
  created_time: string;
  content?: { type: string; text: string }[] | string;
  tool_use_id?: string;
  tool_name?: string;
  input?: unknown;
  is_error?: boolean;
  stop_reason?: string;
  tool_use_ids?: string[];
  error?: { code: string; message: string };
  result?: string;
};
type EventPage = {
  data: PublicSessionEvent[];
  next_page: string | null;
  prev_page: string | null;
  error?: { code: string };
};

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(
  scopes: ApiKeyScope[] = ['sessions.write', 'sessions.read'],
): Promise<{ api_key: ApiKey; secret: string }> {
  return create_api_key(db, {
    workspace_id,
    key_name: 'sessions events key',
    scopes,
    key_audience: 'internal',
    environment_label: 'test',
    actor_id,
  });
}

function key_headers(secret: string) {
  return { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
}

async function open_session(secret: string, body: unknown = {}) {
  const response = await app.request('/v1/sessions', {
    method: 'POST',
    headers: key_headers(secret),
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as { data?: { session_id: string } };
  return parsed.data?.session_id ?? '';
}

async function post_events(secret: string, session_id: string, events: unknown[]) {
  const response = await app.request(`/v1/sessions/${session_id}/events`, {
    method: 'POST',
    headers: key_headers(secret),
    body: JSON.stringify({ events }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: { accepted_event_count: number };
      error?: { code: string };
    },
  };
}

async function get_events(secret: string, session_id: string, query = '') {
  const response = await app.request(`/v1/sessions/${session_id}/events${query}`, {
    headers: key_headers(secret),
  });
  return { status: response.status, body: (await response.json()) as EventPage };
}

async function run_queued_session_jobs(session_id: string) {
  await run_queue_jobs(
    db,
    { workspace_id, queue_key: `session:${session_id}` },
    find_event_job_handler,
  );
}

async function run_the_answered_step(queue_key: string, session_id: string) {
  await run_queue_jobs(db, { workspace_id, queue_key }, find_event_job_handler);
  await run_queue_jobs(
    db,
    { workspace_id, queue_key: `session:${session_id}` },
    find_event_job_handler,
  );
}

async function run_a_turn(secret: string, text: string) {
  const session_id = await open_session(secret, {
    initial_events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  });
  await run_queued_session_jobs(session_id);
  return session_id;
}

async function open_stream_head(
  secret: string,
  session_id: string,
  query = '',
  headers: Record<string, string> = {},
) {
  const response = await app.request(`/v1/sessions/${session_id}/events/stream${query}`, {
    headers: { authorization: `Bearer ${secret}`, accept: 'text/event-stream', ...headers },
  });
  if (response.status === 200) {
    await response.body?.cancel();
    return { status: response.status, error: undefined };
  }
  const body = (await response.json()) as { error?: { code: string } };
  return { status: response.status, error: body.error };
}

async function record_message_snapshot(
  session_id: string,
  run_id: string,
  input: { item_id: string; text: string; item_status: 'streaming' | 'complete' },
) {
  await create_run_event(db, {
    workspace_id,
    session_id,
    run_id,
    event_type: 'chat_event',
    event_label: 'item_updated',
    event_data: {
      patch: { parts: [{ text: input.text, type: 'text' }], item_status: input.item_status },
      item_id: input.item_id,
      event_type: 'item_updated',
    },
    actor_id,
  });
}

async function record_provider_tool_copy(
  session_id: string,
  run_id: string,
  input: { provider_id: string; event_type: 'item_started' | 'item_completed' },
) {
  const is_completed = input.event_type === 'item_completed';
  await create_run_event(db, {
    workspace_id,
    session_id,
    run_id,
    event_type: 'chat_event',
    event_label: input.event_type,
    event_data: {
      event_type: input.event_type,
      item: {
        item_id: `${run_id}:tool:${input.provider_id}`,
        item_type: 'tool_call',
        item_status: is_completed ? 'complete' : 'streaming',
        tool_call_id: input.provider_id,
        provider_tool_call_id: input.provider_id,
        tool_name: 'gmail-send_email-1',
        tool_status: is_completed ? 'completed' : 'running',
        input_data: { to: 'someone@example.com' },
        output_data: {
          details: { content_json: { raw_envelope: 'internal only' }, metadata: { id: 'm_1' } },
        },
        output_text: '{"details":{"content_json":{"raw_envelope":"internal only"}}}',
        file_ids: [],
      },
      source: { source_type: 'runtime_event' },
    },
    actor_id,
  });
}

async function only_run_of(session_id: string) {
  const [run] = await list_session_runs(db, workspace_id, session_id);
  if (!run) throw new Error('the session has no run');
  return run;
}

function hold_a_tool_call_for_approval(session_id: string) {
  return hold_a_tool_call(db, { workspace_id, session_id, actor_id });
}

describe('public session events API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
    engine_behaviour.fails = false;
  });

  it('accepts a message on an idle session and runs it as a turn', async () => {
    const { secret } = await mint_key();
    const session_id = await open_session(secret);

    const sent = await post_events(secret, session_id, [
      { type: 'user.message', content: [{ type: 'text', text: 'Summarize yesterday.' }] },
    ]);
    await run_queued_session_jobs(session_id);

    expect(sent.status).toBe(202);
    expect(sent.body.data).toEqual({ accepted_event_count: 1 });
    const types = (await get_events(secret, session_id)).body.data.map((event) => event.type);
    expect(types).toContain('user.message');
    expect(types).toContain('agent.message');
    expect(types).toContain('session.status_running');
    expect(types.at(-1)).toBe('session.status_idle');
  });

  it('refuses a message while the session is running', async () => {
    const { secret, api_key } = await mint_key();
    const session_id = await open_session(secret);
    await acquire_session_execution_lock(db, {
      workspace_id,
      session_id,
      run_id: 'run_locked',
      lease_ms: 60_000,
      actor_id: api_key.api_key_id,
    });

    const sent = await post_events(secret, session_id, [
      { type: 'user.message', content: [{ type: 'text', text: 'and another thing' }] },
    ]);

    expect(sent.status).toBe(409);
    expect(sent.body.error?.code).toBe('conversation_busy');
  });

  it('refuses an event type v1 does not accept', async () => {
    const { secret } = await mint_key();
    const session_id = await open_session(secret);

    const sent = await post_events(secret, session_id, [{ type: 'user.typing' }]);

    expect(sent.status).toBe(422);
    expect(sent.body.error?.code).toBe('validation_error');
  });

  it('hides another key session from both halves of the events contract', async () => {
    const { secret: owner_secret } = await mint_key();
    const { secret: other_secret } = await mint_key();
    const session_id = await open_session(owner_secret);

    const sent = await post_events(other_secret, session_id, [{ type: 'user.interrupt' }]);
    const read = await get_events(other_secret, session_id);

    expect(sent.status).toBe(404);
    expect(read.status).toBe(404);
    expect(read.body.error?.code).toBe('not_found');
  });

  it('interrupts nothing on an idle session instead of failing', async () => {
    const { secret } = await mint_key();
    const session_id = await open_session(secret);

    const sent = await post_events(secret, session_id, [{ type: 'user.interrupt' }]);

    expect(sent.status).toBe(202);
  });

  it('refuses a message while the session is parked on an approval, but takes a confirmation', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);

    const message = await post_events(secret, session_id, [
      { type: 'user.message', content: [{ type: 'text', text: 'actually, also cc finance' }] },
    ]);
    expect(message.status).toBe(409);
    expect(message.body.error?.code).toBe('conversation_busy');

    const confirmation = await post_events(secret, session_id, [
      { type: 'user.tool_confirmation', tool_use_id: held.tool_call_id, result: 'deny' },
    ]);
    expect(confirmation.status).toBe(202);
  });

  it('interrupts a session parked on an approval, closing the held call and ending the turn', async () => {
    const { secret, api_key } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);

    const sent = await post_events(secret, session_id, [{ type: 'user.interrupt' }]);
    expect(sent.status).toBe(202);

    const wait = await get_tool_policy_wait(db, { workspace_id, job_id: held.job_id });
    expect(wait?.job_status).not.toBe('waiting');

    for (const events of [
      (await get_events(secret, session_id, '?limit=100')).body.data,
      await read_stream(secret, session_id, ''),
    ]) {
      const result = events.find(
        (event) => event.type === 'agent.tool_result' && event.tool_use_id === held.tool_call_id,
      );
      expect(result?.is_error).toBe(true);
      expect(String(result?.content)).toContain('Interrupted before a decision');
      const idle_positions = events.flatMap((event, index) =>
        event.type === 'session.status_idle' ? [{ event, index }] : [],
      );
      const last_idle = idle_positions.at(-1);
      expect(last_idle?.event.stop_reason).toBe('end_turn');
      const result_at = events.findIndex((event) => event === result);
      expect(last_idle?.index ?? -1).toBeGreaterThan(result_at);
    }

    const snapshot = await get_api_session_snapshot(db, api_key, session_id);
    expect(snapshot.status).toBe('idle');
  });

  it('interrupts a parked session whose run still holds the lock, closing the held call', async () => {
    const { secret, api_key } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);
    await acquire_session_execution_lock(db, {
      workspace_id,
      session_id,
      run_id: held.run_id,
      lease_ms: 60_000,
      actor_id: api_key.api_key_id,
    });

    const sent = await post_events(secret, session_id, [{ type: 'user.interrupt' }]);
    expect(sent.status).toBe(202);

    const wait = await get_tool_policy_wait(db, { workspace_id, job_id: held.job_id });
    expect(wait?.job_status).not.toBe('waiting');

    for (const events of [
      (await get_events(secret, session_id, '?limit=100')).body.data,
      await read_stream(secret, session_id, ''),
    ]) {
      const result = events.find(
        (event) => event.type === 'agent.tool_result' && event.tool_use_id === held.tool_call_id,
      );
      expect(result?.is_error).toBe(true);
      expect(String(result?.content)).toContain('Interrupted before a decision');
      const uses = events.filter(
        (event) => event.type === 'agent.tool_use' && event.tool_use_id === held.tool_call_id,
      );
      expect(uses).toHaveLength(1);
      const last_idle = events.filter((event) => event.type === 'session.status_idle').at(-1);
      expect(last_idle?.stop_reason).toBe('end_turn');
    }

    const run = (await list_session_runs(db, workspace_id, session_id)).find(
      (candidate) => candidate.run_id === held.run_id,
    );
    expect(run?.run_status).toBe('cancelled');
    const snapshot = await get_api_session_snapshot(db, api_key, session_id);
    expect(snapshot.status).toBe('idle');
  });

  it('drops the internal event kinds the public vocabulary does not name', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const run = await only_run_of(session_id);
    const before = (await get_events(secret, session_id)).body.data.length;

    await create_run_event(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      event_type: 'progress',
      event_label: 'pi.some_future_internal_signal',
      event_data: { secret_field: 'must not leak' },
      actor_id,
    });
    await create_run_event(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      event_type: 'chat_event',
      event_label: 'item_completed',
      event_data: {
        event_type: 'item_completed',
        item: { item_type: 'artifact', file_id: 'file_1', title: 'Internal draft' },
        source: { source_type: 'runtime_event' },
      },
      actor_id,
    });

    const after = (await get_events(secret, session_id)).body.data;
    expect(after).toHaveLength(before);
    expect(JSON.stringify(after)).not.toContain('must not leak');
    expect(JSON.stringify(after)).not.toContain('Internal draft');
  });

  it('reads the assistant text a streamed run finalizes with an item_updated patch', async () => {
    const { secret, api_key } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const run = await only_run_of(session_id);
    await create_run_event(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      event_type: 'chat_event',
      event_label: 'item_updated',
      event_data: {
        patch: { parts: [{ text: 'ready', type: 'text' }], item_status: 'complete' },
        item_id: `${run.run_id}:assistant:0`,
        event_type: 'item_updated',
      },
      actor_id,
    });

    const messages = (await get_events(secret, session_id, '?types[]=agent.message&limit=50')).body
      .data;

    expect(messages.at(-1)?.content).toEqual([{ type: 'text', text: 'ready' }]);
    const snapshot = await get_api_session_snapshot(db, api_key, session_id);
    expect(snapshot.last_agent_message).toBe('ready');
  });

  it('publishes one message however many snapshots the run wrote for that item', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const run = await only_run_of(session_id);
    const item_id = `${run.run_id}:assistant:0`;
    await record_message_snapshot(session_id, run.run_id, {
      item_id,
      text: 'The payouts',
      item_status: 'streaming',
    });
    await record_message_snapshot(session_id, run.run_id, {
      item_id,
      text: 'The payouts are',
      item_status: 'streaming',
    });
    await record_message_snapshot(session_id, run.run_id, {
      item_id,
      text: 'The payouts are in.',
      item_status: 'complete',
    });
    await record_message_snapshot(session_id, run.run_id, {
      item_id: `${run.run_id}:assistant:1`,
      text: 'Anything else?',
      item_status: 'complete',
    });

    const messages = (await get_events(secret, session_id, '?types[]=agent.message&limit=50')).body
      .data;

    expect(messages.map((event) => event.content)).toEqual([
      [{ type: 'text', text: 'Done.' }],
      [{ type: 'text', text: 'The payouts are in.' }],
      [{ type: 'text', text: 'Anything else?' }],
    ]);
  });

  it('emits thinking as a marker that carries none of the reasoning', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const run = await only_run_of(session_id);
    await create_run_event(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      event_type: 'chat_event',
      event_label: 'item_started',
      event_data: {
        event_type: 'item_started',
        item: {
          item_type: 'thinking',
          text: 'the user probably means payouts',
          item_status: 'streaming',
        },
        source: { source_type: 'runtime_event' },
      },
      actor_id,
    });
    await create_run_event(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      event_type: 'chat_event',
      event_label: 'item_updated',
      event_data: {
        patch: { text: 'the user probably means payouts', item_status: 'complete' },
        item_id: `${run.run_id}:thinking:0`,
        event_type: 'item_updated',
      },
      actor_id,
    });

    const timeline = (await get_events(secret, session_id)).body.data;
    const thinking = timeline.find((event) => event.type === 'agent.thinking');

    expect(thinking).toBeDefined();
    expect(Object.keys(thinking ?? {}).sort()).toEqual(['created_time', 'id', 'type']);
    expect(JSON.stringify(timeline)).not.toContain('probably means payouts');
  });

  it('publishes a tool call once, as the stored copy, in history and on the stream', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const run = await only_run_of(session_id);
    const provider_id = 'toolu_01Doubled';
    const tool_call = await create_tool_call_started(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      node_id: null,
      node_version: null,
      tool_name: 'gmail-send_email-1',
      tool_input: { to: 'someone@example.com' },
      tool_status: 'completed',
      idempotency_key: `${run.run_id}:${provider_id}`,
      tool_call_metadata: { model_tool_call_id: provider_id },
      actor_id,
    });
    const stored = { ...tool_call, output_text: 'Sent the email.' };
    await record_provider_tool_copy(session_id, run.run_id, {
      provider_id,
      event_type: 'item_started',
    });
    await record_chat_stream_event_drafts(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      actor_id,
      drafts: [create_tool_call_started_chat_event_draft({ tool_call: stored })],
    });
    await record_provider_tool_copy(session_id, run.run_id, {
      provider_id,
      event_type: 'item_completed',
    });
    await record_chat_stream_event_drafts(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      actor_id,
      drafts: [create_tool_call_completed_chat_event_draft({ tool_call: stored })],
    });

    const timeline = (await get_events(secret, session_id, '?limit=50')).body.data;
    const streamed = await read_stream(secret, session_id, '');

    for (const events of [timeline, streamed]) {
      const tool_events = events.filter((event) => event.type.startsWith('agent.tool_'));
      expect(tool_events.map((event) => [event.type, event.tool_use_id])).toEqual([
        ['agent.tool_use', tool_call.tool_call_id],
        ['agent.tool_result', tool_call.tool_call_id],
      ]);
      expect(tool_events.at(1)?.content).toBe('Sent the email.');
      expect(JSON.stringify(events)).not.toContain(provider_id);
      expect(JSON.stringify(events)).not.toContain('content_json');
      expect(JSON.stringify(events)).not.toContain('raw_envelope');
    }
  });

  it('reports an internal failure as run_failed and never as the provider said it', async () => {
    engine_behaviour.fails = true;
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'do the thing');

    const errors = (await get_events(secret, session_id)).body.data.filter(
      (event) => event.type === 'session.error',
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.at(0)?.error).toEqual({
      code: 'run_failed',
      message: public_run_failure_message,
    });
    expect(JSON.stringify(errors)).not.toContain('upstream_pool_exhausted');
  });

  it('pages the history forward and filters it by type', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');

    const first = await get_events(secret, session_id, '?limit=2');
    expect(first.body.data).toHaveLength(2);
    expect(first.body.next_page).toBeTruthy();
    expect(first.body.prev_page).toBeNull();

    const second = await get_events(
      secret,
      session_id,
      `?limit=50&page=${encodeURIComponent(first.body.next_page ?? '')}`,
    );
    const all = (await get_events(secret, session_id, '?limit=50')).body.data;
    expect([...first.body.data, ...second.body.data].map((event) => event.id)).toEqual(
      all.map((event) => event.id),
    );

    const only_messages = await get_events(secret, session_id, '?types[]=agent.message&limit=50');
    expect(only_messages.body.data.map((event) => event.type)).toEqual(['agent.message']);

    const nonsense = await get_events(secret, session_id, '?types[]=agent.secrets');
    expect(nonsense.status).toBe(422);
  });

  it('resumes inside a stored row that carries two events', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const all = (await get_events(secret, session_id, '?limit=50')).body.data;
    const usage = all.find((event) => event.type === 'session.usage');

    const after_usage = await get_events(
      secret,
      session_id,
      `?limit=50&page=${encodeURIComponent(usage?.id ?? '')}`,
    );

    expect(usage).toBeDefined();
    expect(after_usage.body.data.map((event) => event.type)).toEqual(['session.status_idle']);
  });

  it('replays the stream from a cursor and never repeats what the cursor covered', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const history = (await get_events(secret, session_id, '?limit=50')).body.data;
    const cursor = history.at(0)?.id ?? '';

    const streamed = await read_stream(secret, session_id, `?cursor=${encodeURIComponent(cursor)}`);

    expect(streamed.length).toBeGreaterThan(0);
    expect(streamed.map((event) => event.id)).toEqual(history.slice(1).map((event) => event.id));
  });

  it('refuses a cursor the stream cannot resume from instead of opening an empty one', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const elsewhere = await run_a_turn(secret, 'a different session');
    const foreign_cursor = (await get_events(secret, elsewhere, '?limit=1')).body.data.at(0)?.id;

    const nonsense = await open_stream_head(secret, session_id, '?cursor=not-an-event-id');
    const foreign = await open_stream_head(secret, session_id, '', {
      'last-event-id': foreign_cursor ?? '',
    });
    const good = await open_stream_head(
      secret,
      session_id,
      `?cursor=${encodeURIComponent((await get_events(secret, session_id, '?limit=1')).body.data.at(0)?.id ?? '')}`,
    );

    expect(nonsense.status).toBe(422);
    expect(nonsense.error?.code).toBe('validation_error');
    expect(foreign.status).toBe(422);
    expect(foreign.error?.code).toBe('validation_error');
    expect(good.status).toBe(200);
  });

  it('shows a held call as requires_action and answers it with a confirmation', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);

    const waiting = (await get_events(secret, session_id, '?limit=50')).body.data;
    const tool_use = waiting.find((event) => event.type === 'agent.tool_use');
    expect(tool_use).toMatchObject({
      tool_use_id: held.tool_call_id,
      tool_name: 'gmail-send_email-1',
      input: { to: 'someone@example.com' },
    });
    const stop = waiting.filter((event) => event.type === 'session.status_idle').at(-1);
    expect(stop?.stop_reason).toBe('requires_action');
    expect(stop?.tool_use_ids).toEqual([held.tool_call_id]);
    expect(waiting.at(-1)?.type).toBe('session.usage');

    const sent = await post_events(secret, session_id, [
      {
        type: 'user.tool_confirmation',
        tool_use_id: held.tool_call_id,
        result: 'deny',
        deny_message: 'not that address',
      },
    ]);

    expect(sent.status).toBe(202);
    const decided = await get_tool_policy_wait(db, { workspace_id, job_id: held.job_id });
    expect(decided?.job_status).not.toBe('waiting');
    const after_the_stop = await get_events(
      secret,
      session_id,
      `?limit=50&page=${encodeURIComponent(stop?.id ?? '')}`,
    );
    expect(after_the_stop.body.data.map((event) => event.type)).toContain('user.tool_confirmation');
    const confirmation = (await get_events(secret, session_id, '?limit=50')).body.data.find(
      (event) => event.type === 'user.tool_confirmation',
    );
    expect(confirmation).toMatchObject({ tool_use_id: held.tool_call_id, result: 'deny' });
  });

  it('publishes the requires_action stop once, from a row that outlives the answer', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);

    const history = (await get_events(secret, session_id, '?limit=50')).body.data;
    const streamed = await read_stream(secret, session_id, '');
    const stops = (events: PublicSessionEvent[]) =>
      events.filter((event) => event.stop_reason === 'requires_action');

    expect(stops(history)).toHaveLength(1);
    expect(stops(streamed).map((event) => event.id)).toEqual(
      stops(history).map((event) => event.id),
    );
    expect(stops(history).at(0)).toMatchObject({ tool_use_ids: [held.tool_call_id] });
    expect(history.findIndex((event) => event.type === 'agent.tool_use')).toBeLessThan(
      history.findIndex((event) => event.stop_reason === 'requires_action'),
    );

    const asked_at = history.findIndex((event) => event.stop_reason === 'requires_action');
    expect(history.slice(asked_at).map((event) => event.stop_reason)).not.toContain('end_turn');
    expect(history.slice(asked_at).map((event) => event.type)).toContain('session.usage');

    await post_events(secret, session_id, [
      { type: 'user.tool_confirmation', tool_use_id: held.tool_call_id, result: 'allow' },
    ]);
    const after = (await get_events(secret, session_id, '?limit=50')).body.data;
    expect(stops(after).map((event) => event.id)).toEqual(stops(history).map((event) => event.id));
  });

  it('delivers a denial as the call result, to the caller and to the model', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);

    await post_events(secret, session_id, [
      {
        type: 'user.tool_confirmation',
        tool_use_id: held.tool_call_id,
        result: 'deny',
        deny_message: 'not now',
      },
    ]);
    await run_the_answered_step(held.queue_key, session_id);

    const history = (await get_events(secret, session_id, '?limit=100')).body.data;
    const streamed = await read_stream(secret, session_id, '');
    for (const events of [history, streamed]) {
      const refusal = events.find(
        (event) => event.type === 'agent.tool_result' && event.tool_use_id === held.tool_call_id,
      );
      expect(refusal?.is_error).toBe(true);
      expect(String(refusal?.content)).toContain('not now');
    }
    const messages = await list_run_messages(db, workspace_id, held.run_id);
    const model_result = messages.find((message) => message.tool_call_id === held.tool_call_id);
    expect(model_result?.content_text).toContain('A person said no to this');
    expect(model_result?.content_text).toContain('not now');
    expect(JSON.stringify(model_result?.message_content)).not.toContain('Waiting for a person');
  });

  it('keeps the parked run completion out of the transcript after the answer lands', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);

    await post_events(secret, session_id, [
      {
        type: 'user.tool_confirmation',
        tool_use_id: held.tool_call_id,
        result: 'deny',
        deny_message: 'not now',
      },
    ]);
    await run_the_answered_step(held.queue_key, session_id);

    const history = (await get_events(secret, session_id, '?limit=100')).body.data;
    const asked_at = history.findIndex((event) => event.stop_reason === 'requires_action');
    const answered_at = history.findIndex((event) => event.type === 'user.tool_confirmation');
    expect(asked_at).toBeGreaterThanOrEqual(0);
    expect(answered_at).toBeGreaterThan(asked_at);
    expect(history.slice(asked_at, answered_at).map((event) => event.stop_reason)).not.toContain(
      'end_turn',
    );
    const streamed = await read_stream(secret, session_id, '');
    expect(streamed.map((event) => [event.type, event.stop_reason])).toEqual(
      history.map((event) => [event.type, event.stop_reason]),
    );
  });

  it('keeps the stop id still while the parked run writes more rows', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(session_id);
    const before = (await get_events(secret, session_id, '?limit=50')).body.data;

    await record_message_snapshot(session_id, held.run_id, {
      item_id: `${held.run_id}:assistant:9`,
      text: 'I need somebody to approve that.',
      item_status: 'complete',
    });

    const after = (await get_events(secret, session_id, '?limit=50')).body.data;
    const stop_id = (events: PublicSessionEvent[]) =>
      events.find((event) => event.stop_reason === 'requires_action')?.id;
    expect(stop_id(after)).toBe(stop_id(before));
    expect(after.filter((event) => event.stop_reason === 'requires_action')).toHaveLength(1);
  });

  it('holds an ask-policy tool for the key that opened the session, and takes that key answer', async () => {
    const { secret, api_key } = await mint_key();
    const session_id = await run_a_turn(secret, 'send the email');
    const run = await only_run_of(session_id);
    await seed_runtime_tool_catalog(db);
    await set_policy(db, {
      workspace_id,
      resource_type: 'node',
      resource_id: 'math-calculate-1',
      scope_type: 'workspace',
      scope_id: workspace_id,
      policy_mode: 'ask',
      actor_id,
    });

    const gate = create_tool_batch_policy(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      agent_id: run.agent_id,
      actor_id: api_key.api_key_id,
    });
    const decision = await gate.decide([
      { tool_call_id: 'call_1', tool_name: 'math-calculate-1', input: { expression: '2 + 2' } },
    ]);

    expect(decision.kind).toBe('needs_approval');
    const [wait] = await list_tool_policy_waits(db, { workspace_id, status: 'waiting' });
    expect(wait?.job_status).toBe('waiting');
    expect(wait?.metadata.policy_approval).toMatchObject({
      eligible_user_ids: [api_key.api_key_id],
    });
    expect((await find_run_wait(db, { workspace_id, run_id: run.run_id }))?.job_id).toBe(
      wait?.job_id,
    );
    const [held] = await list_run_tool_calls(db, workspace_id, run.run_id);
    expect(held?.tool_status).toBe('awaiting_approval');

    const sent = await post_events(secret, session_id, [
      { type: 'user.tool_confirmation', tool_use_id: held?.tool_call_id ?? '', result: 'allow' },
    ]);

    expect(sent.status).toBe(202);
    expect(
      (await get_tool_policy_wait(db, { workspace_id, job_id: wait?.job_id ?? '' }))?.job_status,
    ).not.toBe('waiting');
    const answer = decision.kind === 'needs_approval' ? await decision.wait_for_answer() : null;
    expect(answer).toMatchObject({ answer: 'approved' });
  });

  it('keeps one key from deciding another key session approval', async () => {
    const { secret: owner_secret } = await mint_key();
    const { secret: other_secret } = await mint_key();
    const owned_session = await run_a_turn(owner_secret, 'send the email');
    const held = await hold_a_tool_call_for_approval(owned_session);
    const other_session = await open_session(other_secret);

    const sent = await post_events(other_secret, other_session, [
      { type: 'user.tool_confirmation', tool_use_id: held.tool_call_id, result: 'allow' },
    ]);

    expect(sent.status).toBe(404);
    const still_waiting = await get_tool_policy_wait(db, { workspace_id, job_id: held.job_id });
    expect(still_waiting?.job_status).toBe('waiting');
  });

  it('refuses a confirmation for a tool use nobody is waiting on', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const run = await only_run_of(session_id);
    const tool_call = await create_tool_call_started(db, {
      workspace_id,
      session_id,
      run_id: run.run_id,
      node_id: null,
      node_version: null,
      tool_name: 'runtime-execute_tool-1',
      tool_input: {},
      tool_status: 'completed',
      idempotency_key: `${run.run_id}:free-call`,
      actor_id,
    });

    const sent = await post_events(secret, session_id, [
      { type: 'user.tool_confirmation', tool_use_id: tool_call.tool_call_id, result: 'allow' },
    ]);

    expect(sent.status).toBe(422);
    expect(sent.body.error?.code).toBe('event_not_sendable');
  });
});

describe('the session event stream, held open', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
    engine_behaviour.fails = false;
  });

  function open_stream(secret: string, session_id: string, signal?: AbortSignal) {
    return app.request(`/v1/sessions/${session_id}/events/stream`, {
      headers: { authorization: `Bearer ${secret}`, accept: 'text/event-stream' },
      ...(signal ? { signal } : {}),
    });
  }

  async function read_raw(reader: ReadableStreamDefaultReader<Uint8Array>, until: string | null) {
    const decoder = new TextDecoder();
    let text = '';
    let closed = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (until === null || !text.includes(until))) {
      const read = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
      ]);
      if (read === null) continue;
      if (read.done) {
        closed = true;
        break;
      }
      text += decoder.decode(read.value, { stream: true });
    }
    return { text, closed };
  }

  function event_ids(text: string) {
    return text
      .split('\n')
      .filter((line) => line.startsWith('id: '))
      .map((line) => line.slice('id: '.length));
  }

  it('ends at its lifetime with a reconnect comment, and Last-Event-ID resumes right after it', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const real_set_timeout = globalThis.setTimeout;
    let end_the_lifetime: (() => void) | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      milliseconds?: number,
    ) => {
      if (milliseconds !== max_session_event_stream_lifetime_ms) {
        return real_set_timeout(handler, milliseconds);
      }
      end_the_lifetime = handler;
      return real_set_timeout(() => undefined, 0);
    }) as typeof setTimeout);

    const reader = (await open_stream(secret, session_id)).body?.getReader();
    if (!reader) throw new Error('the stream has no body');
    vi.restoreAllMocks();
    const replayed = await read_raw(reader, 'session.status_idle');
    end_the_lifetime?.();
    const ending = await read_raw(reader, null);

    expect(end_the_lifetime).toBeDefined();
    expect(ending.closed).toBe(true);
    expect(ending.text).toContain(': stream lifetime reached; reconnect with Last-Event-ID');
    const seen = event_ids(replayed.text + ending.text);
    const last_seen = seen.at(-1) ?? '';

    await post_events(secret, session_id, [
      { type: 'user.message', content: [{ type: 'text', text: 'and again' }] },
    ]);
    await run_queued_session_jobs(session_id);
    const resumed = await read_stream(secret, session_id, '', { 'last-event-id': last_seen });
    const history = (await get_events(secret, session_id, '?limit=100')).body.data;

    expect(seen).toEqual(history.slice(0, seen.length).map((event) => event.id));
    expect(resumed.map((event) => event.id)).toEqual(
      history.slice(seen.length).map((event) => event.id),
    );
    expect(resumed.at(0)?.type).toBe('user.message');
  });

  it('closes a held stream once its key is revoked', async () => {
    const { secret, api_key } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');

    const reader = (await open_stream(secret, session_id)).body?.getReader();
    if (!reader) throw new Error('the stream has no body');
    await read_raw(reader, 'session.status_idle');
    await revoke_api_key(db, { workspace_id, api_key_id: api_key.api_key_id, actor_id });
    const ending = await read_raw(reader, null);

    expect(ending.closed).toBe(true);
    expect(ending.text).toContain(': this API key was revoked or expired; stream closed');
  });

  it('refuses a stream past the per-key ceiling, and a client that hangs up frees its slot', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret, 'hello');
    const hang_ups = Array.from(
      { length: max_open_long_polls_per_api_key },
      () => new AbortController(),
    );
    const held = await Promise.all(
      hang_ups.map((hang_up) => open_stream(secret, session_id, hang_up.signal)),
    );
    expect(held.map((response) => response.status)).toEqual(hang_ups.map(() => 200));

    const one_too_many = await open_stream_head(secret, session_id);
    expect(one_too_many).toEqual({
      status: 429,
      error: expect.objectContaining({ code: 'too_many_open_streams' }),
    });

    hang_ups[0]?.abort();
    await vi.waitFor(
      async () => expect((await open_stream_head(secret, session_id)).status).toBe(200),
      { timeout: 3_000, interval: 50 },
    );

    for (const hang_up of hang_ups) hang_up.abort();
  });
});

async function read_stream(
  secret: string,
  session_id: string,
  query: string,
  headers: Record<string, string> = {},
) {
  const abort = new AbortController();
  const response = await app.request(`/v1/sessions/${session_id}/events/stream${query}`, {
    headers: { authorization: `Bearer ${secret}`, accept: 'text/event-stream', ...headers },
    signal: abort.signal,
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('the stream has no body');

  const text = await read_until_the_stream_goes_quiet(reader);
  abort.abort();
  await reader.cancel().catch(() => undefined);

  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as PublicSessionEvent);
}

const longest_wait_for_the_stream_ms = 5_000;
const pause_that_ends_the_history_ms = 1_000;

async function read_until_the_stream_goes_quiet(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  const stop_time = Date.now() + longest_wait_for_the_stream_ms;
  let text = '';
  while (Date.now() < stop_time) {
    const patience_ms = text ? pause_that_ends_the_history_ms : stop_time - Date.now();
    const chunk = await Promise.race([reader.read(), sleep(patience_ms)]);
    if (!chunk || chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}
