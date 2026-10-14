import type { LlmResolvedRequest } from '@agent-core/llm_gateway';
import type { RuntimeAgentEngine } from '@agent-core/runs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const engine = { user_texts: [] as string[], holds_every_run: false };

const scripted_engine = (): RuntimeAgentEngine => ({
  engine_name: 'agent-core/pi/test',
  async *run(input) {
    const latest_user_text =
      [...input.messages]
        .reverse()
        .find((message) => message.role === 'user')
        ?.content.filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n') ?? '';
    engine.user_texts.push(latest_user_text);
    while (engine.holds_every_run && !input.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    yield {
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: `Did: ${latest_user_text}` }] },
    };
  },
});

vi.mock('@agent-core/llm_gateway/adapters/pi_ai_adapter', () => ({
  create_pi_ai_adapter: () => ({
    async generate_text(input: LlmResolvedRequest) {
      const text = '{"title":"Stop and send"}';
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
  engine.user_texts.length = 0;
  engine.holds_every_run = false;
  vi.unstubAllEnvs();
  vi.resetModules();
});

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
type QueuedRow = { client_message_id: string; state: string; waiting_reason: string };
type RunRow = { run_id: string; run_status: string; created_time: string };
type MessageRow = {
  message_role: string;
  message_sequence: number;
  is_user_visible: boolean;
  run_id: string;
  source_metadata: { client_message_id?: string };
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
  const created = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_title: 'Stop and send' }),
  });
  const session_id = ((await created.json()).data as { session_id: string }).session_id;
  const read = async <T>(path: string) =>
    (await (await app.request(`/v1/sessions/${session_id}/${path}`)).json()).data as T;
  return {
    send: (message: string) =>
      app.request(`/v1/sessions/${session_id}/queued-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, client_message_id: `client:${message}` }),
      }),
    stop: (run_id: string) => app.request(`/v1/runs/${run_id}/cancel`, { method: 'POST' }),
    send_paused_now: () =>
      app.request(`/v1/sessions/${session_id}/queued-messages/resume`, { method: 'POST' }),
    queued: () => read<QueuedRow[]>('queued-messages'),
    runs: () => read<RunRow[]>('runs'),
    messages: async () => (await read<{ items: MessageRow[] }>('messages')).items,
  };
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

type Chat = Awaited<ReturnType<typeof open_chat>>;

async function wait_for_run_of(chat: Chat, message: string) {
  await wait_until(
    async () => engine.user_texts,
    (texts) => texts.includes(message),
  );
  const runs = await wait_until(chat.runs, (listed) => listed[0]?.run_status === 'running');
  const [newest_run] = runs;
  if (!newest_run) throw new Error('No run started.');
  return newest_run;
}

function queue_as_the_chat_draws_it(queued: QueuedRow[]) {
  return queued.map((row) => `${row.client_message_id.replace('client:', '')} ${row.state}`);
}

const paused = (text: string) => `${text} paused`;

describe('send, stop, send again, in quick succession', () => {
  it('runs each new message at once, keeps the paused ones in send order, and loses none', async () => {
    const chat = await open_chat();
    engine.holds_every_run = true;

    await chat.send('four');
    const run_four = await wait_for_run_of(chat, 'four');
    expect((await chat.stop(run_four.run_id)).status).toBe(200);
    expect((await chat.runs()).map((run) => run.run_status)).toEqual(['cancelled']);
    expect(await chat.queued()).toEqual([]);

    await chat.send('five');
    const run_five = await wait_for_run_of(chat, 'five');
    await chat.send('six');
    await chat.send('seven');
    expect(queue_as_the_chat_draws_it(await chat.queued())).toEqual(['six queued', 'seven queued']);
    await chat.stop(run_five.run_id);
    expect(queue_as_the_chat_draws_it(await chat.queued())).toEqual([
      paused('six'),
      paused('seven'),
    ]);

    await chat.send('eight');
    const run_eight = await wait_for_run_of(chat, 'eight');
    await chat.send('nine');
    await chat.stop(run_eight.run_id);
    const three_paused = [paused('six'), paused('seven'), paused('nine')];
    expect(queue_as_the_chat_draws_it(await chat.queued())).toEqual(three_paused);

    await chat.send('ten');
    await wait_for_run_of(chat, 'ten');
    expect(queue_as_the_chat_draws_it(await chat.queued())).toEqual(three_paused);
    expect(engine.user_texts).toEqual(['four', 'five', 'eight', 'ten']);

    engine.holds_every_run = false;
    expect((await chat.send_paused_now()).status).toBe(200);
    await wait_until(chat.runs, (runs) => runs.length === 7 && runs.every(has_ended));
    expect(engine.user_texts).toEqual(['four', 'five', 'eight', 'ten', 'six', 'seven', 'nine']);
    expect(await chat.queued()).toEqual([]);
    const sent_by_a_person = (await chat.messages()).filter(
      (message) => message.message_role === 'user',
    );
    expect(sent_by_a_person.map((message) => message.source_metadata.client_message_id)).toEqual(
      ['four', 'five', 'eight', 'ten', 'six', 'seven', 'nine'].map((text) => `client:${text}`),
    );
  }, 60_000);
});

function has_ended(run: RunRow) {
  return run.run_status === 'completed' || run.run_status === 'cancelled';
}
