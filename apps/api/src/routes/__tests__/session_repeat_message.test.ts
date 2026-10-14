import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmResolvedRequest } from '@agent-core/llm_gateway';
import type { RuntimeAgentEngine } from '@agent-core/runs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const engine = {
  user_turns: [] as { text: string; part_types: string[] }[],
  is_holding: false,
};

const scripted_engine = (): RuntimeAgentEngine => ({
  engine_name: 'agent-core/pi/test',
  async *run(input) {
    const last_user_message = [...input.messages].reverse().find((item) => item.role === 'user');
    const content = last_user_message?.content ?? [];
    const text = content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
    engine.user_turns.push({ text, part_types: content.map((part) => part.type) });
    if (text === 'Fail this') throw new Error('The model broke.');
    if (text === 'Hold until released') {
      while (engine.is_holding && !input.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    yield {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Answer ${engine.user_turns.length} to: ${text}` }],
      },
    };
  },
});

vi.mock('@agent-core/llm_gateway/adapters/pi_ai_adapter', () => ({
  create_pi_ai_adapter: () => ({
    async generate_text(input: LlmResolvedRequest) {
      const text = '{"title":"Repeat chat"}';
      return {
        text,
        message: { role: 'assistant' as const, content: [{ type: 'text' as const, text }] },
        model: {
          model_provider: input.model.model_provider,
          model_proxy: input.model.model_proxy,
          model_name: input.model.model_name,
        },
        metadata: {},
      };
    },
    async *stream() {},
  }),
}));

afterEach(() => {
  engine.user_turns.length = 0;
  engine.is_holding = false;
  vi.unstubAllEnvs();
  vi.resetModules();
});

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
type StoredMessage = {
  run_message_id: string;
  run_id: string;
  message_role: string;
  is_user_visible: boolean;
  message_content: { text?: string };
  source_metadata: Record<string, unknown>;
};

async function open_chat() {
  vi.stubEnv('COWORKER_WORKSPACE_RUNTIME_PROVIDER', 'local');
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
  vi.resetModules();
  const { configure_agent_engine } = await import('@runtime-platform/orchestrator/agent_engine');
  configure_agent_engine(scripted_engine);
  const { create_app } = await import('@api/app');
  const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
  const { seed_native_catalogs } = await import('@coworker/runtime-platform');
  const db = await create_test_database();
  await seed_native_catalogs(db);
  const app: App = create_app(db);
  const created = await app.request('/v1/sessions', post({ session_title: 'Repeat test' }));
  const session = (await created.json()).data as { session_id: string };
  return { app, session_id: session.session_id };
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function send(app: App, session_id: string, body: Record<string, unknown>) {
  return app.request(`/v1/sessions/${session_id}/queued-messages`, post(body));
}

function repeat(app: App, session_id: string, body: Record<string, unknown>) {
  return app.request(`/v1/sessions/${session_id}/queued-messages/repeat`, post(body));
}

async function read_data<T>(app: App, path: string) {
  return (await (await app.request(path)).json()).data as T;
}

function list_runs(app: App, session_id: string) {
  return read_data<{ run_id: string; run_status: string }[]>(
    app,
    `/v1/sessions/${session_id}/runs`,
  );
}

async function list_messages(app: App, session_id: string) {
  const page = await read_data<{ items: StoredMessage[] }>(
    app,
    `/v1/sessions/${session_id}/messages`,
  );
  return page.items;
}

async function wait_until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  let value = await read();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !done(value)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = await read();
  }
  if (!done(value)) throw new Error(`Timed out; last value ${JSON.stringify(value)}`);
  return value;
}

function wait_for_runs(app: App, session_id: string, statuses: string[]) {
  return wait_until(
    () => list_runs(app, session_id),
    (runs) =>
      runs.length === statuses.length &&
      [...statuses].sort().join() ===
        runs
          .map((run) => run.run_status)
          .sort()
          .join(),
  );
}

async function read_shown_chat(app: App, session_id: string) {
  const messages = await list_messages(app, session_id);
  return messages
    .filter((message) => message.is_user_visible)
    .filter((message) => ['user', 'assistant'].includes(message.message_role))
    .map((message) => `${message.message_role}: ${message.message_content.text ?? ''}`);
}

async function find_sent_message(app: App, session_id: string, client_message_id: string) {
  const messages = await list_messages(app, session_id);
  const sent = messages.find(
    (message) => message.source_metadata.client_message_id === client_message_id,
  );
  if (!sent) throw new Error(`No stored message for ${client_message_id}`);
  return sent;
}

describe('running a chat message again', () => {
  it('answers a finished message again and keeps the one message the person sent', async () => {
    const { app, session_id } = await open_chat();
    await send(app, session_id, { message: 'Count the planets', client_message_id: 'draft-1' });
    await wait_for_runs(app, session_id, ['completed']);
    const sent = await find_sent_message(app, session_id, 'draft-1');

    const repeated = await repeat(app, session_id, {
      run_message_id: sent.run_message_id,
      client_message_id: 'repeat-1',
    });

    expect(repeated.status).toBe(202);
    await wait_for_runs(app, session_id, ['completed', 'completed']);
    expect(engine.user_turns.map((turn) => turn.text)).toEqual([
      'Count the planets',
      'Count the planets',
    ]);
    expect(await read_shown_chat(app, session_id)).toEqual([
      'user: Count the planets',
      'assistant: Answer 1 to: Count the planets',
      'assistant: Answer 2 to: Count the planets',
    ]);
    const hidden_repeat = await find_sent_message(app, session_id, 'repeat-1');
    expect(hidden_repeat).toMatchObject({
      message_role: 'user',
      is_user_visible: false,
      source_metadata: { repeats_run_message_id: sent.run_message_id },
    });
  }, 45_000);

  it('answers a stopped message again', async () => {
    const { app, session_id } = await open_chat();
    engine.is_holding = true;
    await send(app, session_id, { message: 'Hold until released', client_message_id: 'draft-1' });
    const [running] = await wait_for_runs(app, session_id, ['running']);
    await wait_until(
      async () => engine.user_turns.length,
      (turns) => turns === 1,
    );
    const stopped = await app.request(`/v1/runs/${running?.run_id}/cancel`, { method: 'POST' });
    expect(stopped.status).toBe(200);
    await wait_for_runs(app, session_id, ['cancelled']);
    engine.is_holding = false;
    const sent = await find_sent_message(app, session_id, 'draft-1');

    const repeated = await repeat(app, session_id, {
      run_message_id: sent.run_message_id,
      client_message_id: 'repeat-1',
    });

    expect(repeated.status).toBe(202);
    await wait_for_runs(app, session_id, ['cancelled', 'completed']);
    const shown = await read_shown_chat(app, session_id);
    expect(shown.filter((line) => line.startsWith('user:'))).toEqual(['user: Hold until released']);
    expect(shown.at(-1)).toBe('assistant: Answer 2 to: Hold until released');
  }, 45_000);

  it('answers a failed message again', async () => {
    const { app, session_id } = await open_chat();
    await send(app, session_id, { message: 'Fail this', client_message_id: 'draft-1' });
    await wait_for_runs(app, session_id, ['failed']);
    const sent = await find_sent_message(app, session_id, 'draft-1');

    const repeated = await repeat(app, session_id, {
      run_message_id: sent.run_message_id,
      client_message_id: 'repeat-1',
    });

    expect(repeated.status).toBe(202);
    await wait_for_runs(app, session_id, ['failed', 'failed']);
    expect(engine.user_turns.map((turn) => turn.text)).toEqual(['Fail this', 'Fail this']);
    const shown = await read_shown_chat(app, session_id);
    expect(shown.filter((line) => line.startsWith('user:'))).toEqual(['user: Fail this']);
  }, 45_000);

  it('gives the run the attachment of the first send, not only the text', async () => {
    vi.stubEnv('COWORKER_FILE_STORAGE_PATH', await mkdtemp(join(tmpdir(), 'repeat-message-')));
    const { app, session_id } = await open_chat();
    const first = await send(app, session_id, {
      message: 'Read the note',
      content: [{ type: 'file', name: 'note.txt', mime_type: 'text/plain', text: 'Eight.' }],
      client_message_id: 'draft-1',
    });
    expect(await first.json()).toMatchObject({ data: { waiting_reason: 'starting' } });
    await wait_for_runs(app, session_id, ['completed']);
    const sent = await find_sent_message(app, session_id, 'draft-1');

    await repeat(app, session_id, {
      run_message_id: sent.run_message_id,
      client_message_id: 'repeat-1',
    });

    await wait_for_runs(app, session_id, ['completed', 'completed']);
    expect(engine.user_turns).toHaveLength(2);
    expect(engine.user_turns[1]).toEqual(engine.user_turns[0]);
    expect(engine.user_turns[1]?.part_types).toContain('file');
  }, 45_000);

  it('marks the repeat in the queue while it waits, so the chat draws no second bubble', async () => {
    const { app, session_id } = await open_chat();
    await send(app, session_id, { message: 'Count the planets', client_message_id: 'draft-1' });
    await wait_for_runs(app, session_id, ['completed']);
    const sent = await find_sent_message(app, session_id, 'draft-1');
    engine.is_holding = true;
    await send(app, session_id, { message: 'Hold until released', client_message_id: 'draft-2' });
    await wait_for_runs(app, session_id, ['completed', 'running']);

    await repeat(app, session_id, {
      run_message_id: sent.run_message_id,
      client_message_id: 'repeat-1',
    });

    const queued = await read_data<Record<string, unknown>[]>(
      app,
      `/v1/sessions/${session_id}/queued-messages`,
    );
    expect(queued).toEqual([
      expect.objectContaining({
        client_message_id: 'repeat-1',
        repeats_run_message_id: sent.run_message_id,
        waiting_reason: 'session_busy',
      }),
    ]);
    engine.is_holding = false;
    await wait_for_runs(app, session_id, ['completed', 'completed', 'completed']);
  }, 45_000);

  it('refuses a message that is not a message the person sent in this chat', async () => {
    const { app, session_id } = await open_chat();
    await send(app, session_id, { message: 'Count the planets', client_message_id: 'draft-1' });
    await wait_for_runs(app, session_id, ['completed']);
    const messages = await list_messages(app, session_id);
    const answer = messages.find((message) => message.message_role === 'assistant');

    const of_an_answer = await repeat(app, session_id, {
      run_message_id: answer?.run_message_id,
      client_message_id: 'repeat-1',
    });
    const of_nothing = await repeat(app, session_id, {
      run_message_id: 'msg_does_not_exist',
      client_message_id: 'repeat-2',
    });
    const with_no_message = await repeat(app, session_id, { client_message_id: 'repeat-3' });

    expect([of_an_answer.status, of_nothing.status, with_no_message.status]).toEqual([
      404, 404, 422,
    ]);
    expect(await list_runs(app, session_id)).toHaveLength(1);
  }, 45_000);
});
