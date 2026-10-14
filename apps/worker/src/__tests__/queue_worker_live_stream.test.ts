import type { LlmResolvedRequest } from '@agent-core/llm_gateway';
import { create_app } from '@api/app';
import { create_rivet_doorbell } from '@api/services/events/rivet_doorbell';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { create_project } from '@coworker/core/db/queries/projects';
import { runs, sessions, workspace_members } from '@coworker/core/db/schema';
import { configure_event_job_doorbell } from '@coworker/jobs';
import { find_event_job_handler, seed_native_catalogs } from '@coworker/runtime-platform';
import { create_logger } from '@coworker/shared';
import {
  issue_run_stream_ticket,
  run_stream_ticket_lifetime_ms,
} from '@runtime-platform/chat_stream/run_stream_ticket';
import { sign_queue_worker_control } from '@runtime-platform/orchestrator/queue_worker_control';
import { start_rivet_test_engine, type TestEngine } from '@worker/__tests__/rivet_test_engine';
import { create_worker_registry, type WorkerRegistry } from '@worker/registry';
import type { WorkerServices } from '@worker/worker_services';
import { and, eq } from 'drizzle-orm';
import { createClient } from 'rivetkit/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const engine_state = { timeline: [] as string[], unwind_ms: 800 };

vi.mock('@agent-core/llm_gateway/adapters/pi_ai_adapter', () => ({
  create_pi_ai_adapter: () => ({
    async generate_text(input: LlmResolvedRequest) {
      const text = '{"title":"Live chat"}';
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

type LiveRunEvent = {
  type: string;
  run?: { run_id: string; run_status: string };
  event?: { event_type: string; run_id: string; delta?: { text?: string } };
  message?: { run_id: string; message_role: string };
};
type TicketResponse = {
  rivet_endpoint: string;
  rivet_token: string | null;
  actor_key: [string, string, string];
  ticket: string;
};

const openai_responses_url = 'https://api.openai.com/v1/responses';
const real_fetch = globalThis.fetch;
const model_request_schema = z.object({
  input: z.array(
    z.object({
      role: z.string().optional(),
      content: z.union([z.string(), z.array(z.object({ text: z.string().optional() }))]).optional(),
    }),
  ),
});
type ModelStreamEvent = { type: string } & Record<string, unknown>;

const original_env = { ...env };
const worker_log: string[] = [];
let engine: TestEngine;
let registry: WorkerRegistry;
let db: Database;
let app: ReturnType<typeof create_app>;
let client: ReturnType<typeof createClient<WorkerRegistry>>;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetch_with_model_reply);
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
  engine = await start_rivet_test_engine();
  Object.assign(env, {
    EVENT_JOB_DISPATCH_MODE: 'rivet',
    WORKER_MAX_CONCURRENT_RUNS: 8,
    COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'local',
    RIVET_ENDPOINT: engine.connection.endpoint,
    RIVET_TOKEN: engine.connection.token,
    RIVET_PUBLIC_ENDPOINT: engine.connection.endpoint,
    RIVET_CONNECTION_TOKEN: engine.connection.token,
    RIVET_NAMESPACE: undefined,
    RIVET_REGION: undefined,
  });
  db = await create_test_database();
  await seed_native_catalogs(db);
  app = create_app(db);
  configure_event_job_doorbell(create_rivet_doorbell(engine.connection));
  const log = create_logger('worker_live_test');
  const services: WorkerServices = {
    db,
    find_event_job_handler,
    log: { ...log, info: (message: string) => worker_log.push(message) },
    now: () => new Date(),
    rivet_region: undefined,
    rivet_key_scope: 'default',
    rivet_engine: engine.connection,
  };
  registry = create_worker_registry(services, engine.connection);
  await registry.startAndWait();
  client = createClient<WorkerRegistry>(engine.connection);
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  configure_event_job_doorbell(undefined);
  Object.assign(env, original_env);
  await Promise.race([registry?.shutdown(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  await engine?.stop();
}, 30_000);

describe('live chat socket to the queue worker', () => {
  it('streams run_created, token deltas and the run end of a queued message to a ticket holder', async () => {
    const session_id = await open_chat();
    const ticket = await get_ticket(session_id);
    const received: LiveRunEvent[] = [];
    const connection = client.queue_worker.get(ticket.actor_key).connect({ ticket: ticket.ticket });
    connection.on('run_event', (event: LiveRunEvent) => received.push(event));
    await connection.ready;

    await send(session_id, 'Say something');
    await wait_until(() => received.some((event) => event.run?.run_status === 'completed'));
    await connection.dispose();

    const run_id = received.find((event) => event.type === 'run_created')?.run?.run_id;
    expect(run_id).toBeTruthy();
    const chat_event_types = received.flatMap((event) =>
      event.type === 'chat_event' ? [event.event?.event_type] : [],
    );
    expect(chat_event_types).toContain('run_completed');
    const deltas = received.flatMap((event) =>
      event.event?.event_type === 'item_delta' ? [event.event.delta?.text ?? ''] : [],
    );
    expect(deltas.join('')).toBe('Streamed word by word');
    expect(received.map((event) => event.type)).toEqual(
      expect.arrayContaining(['run_created', 'run_updated', 'message_created', 'chat_event']),
    );
    for (const event of received) {
      expect(event.run?.run_id ?? event.event?.run_id ?? event.message?.run_id).toBe(run_id);
    }
  }, 60_000);

  it('refuses a forged ticket, a ticket for another chat, and a removed member', async () => {
    const session_id = await open_chat();
    const other_session_id = await open_chat();
    const ticket = await get_ticket(session_id);
    const other_ticket = await get_ticket(other_session_id);

    expect(await connect_error(ticket.actor_key, `${ticket.ticket}x`)).toMatchObject({
      code: 'run_stream_ticket_refused',
    });
    expect(await connect_error(ticket.actor_key, other_ticket.ticket)).toMatchObject({
      code: 'run_stream_ticket_refused',
    });

    await set_membership('inactive');
    try {
      expect(await connect_error(ticket.actor_key, ticket.ticket)).toMatchObject({
        code: 'stream_access_refused',
      });
    } finally {
      await set_membership('active');
    }
    expect(await connect_error(ticket.actor_key, ticket.ticket)).toBeNull();
  }, 60_000);

  it('closes a socket once its ticket expires, idle or busy, and sends it nothing after', async () => {
    const idle_session_id = await open_chat();
    const busy_session_id = await open_chat();
    const idle_ticket = await get_ticket(idle_session_id);
    const busy_ticket = await get_ticket(busy_session_id);
    const idle = open_socket(
      idle_ticket.actor_key,
      await ticket_expiring_in(idle_session_id, 2_500),
    );
    const busy = open_socket(
      busy_ticket.actor_key,
      await ticket_expiring_in(busy_session_id, 2_500),
    );
    const healthy = open_socket(busy_ticket.actor_key, busy_ticket.ticket);
    await Promise.all([idle.ready, busy.ready, healthy.ready]);

    await new Promise((resolve) => setTimeout(resolve, 2_600));
    await send(busy_session_id, 'After the expiry');
    await wait_until(() => healthy.received.some((event) => event.run?.run_status === 'completed'));
    await wait_until(() => busy.is_closed());
    expect(busy.received).toEqual([]);

    await wait_until(() => idle.is_closed(), 15_000);
    expect(healthy.is_closed()).toBe(false);
    await Promise.all([idle.dispose(), busy.dispose(), healthy.dispose()]);
  }, 60_000);

  it('refuses a member who can no longer read the chat, on connect and on events_after', async () => {
    const session_id = await open_chat();
    await send(session_id, 'Soon private');
    const run_id = await wait_for_completed_run(session_id);
    const ticket = await get_ticket(session_id);
    const socket = open_socket(ticket.actor_key, ticket.ticket);
    await socket.ready;
    const read_back = () =>
      socket.connection.events_after({ ticket: ticket.ticket, run_id, after_sequence: 0 });
    expect((await read_back()).length).toBeGreaterThan(0);

    await move_session_to_project_of_somebody_else(session_id);
    try {
      await expect(read_back()).rejects.toMatchObject({ code: 'stream_access_refused' });
      expect(await connect_error(ticket.actor_key, ticket.ticket)).toMatchObject({
        code: 'stream_access_refused',
      });
    } finally {
      await db
        .update(sessions)
        .set({ project_id: null })
        .where(eq(sessions.session_id, session_id));
      await socket.dispose();
    }
    expect(await connect_error(ticket.actor_key, ticket.ticket)).toBeNull();
  }, 60_000);

  it('lets only a server ring the queue, and only with a signature for this queue', async () => {
    const session_id = await open_chat();
    const ticket = await get_ticket(session_id);
    const [key_scope, workspace_id, queue_key] = ticket.actor_key;
    const ring_with = (params: unknown) =>
      client.queue_worker.get(ticket.actor_key, { params }).send('wake', { job_id: 'job_x' });

    await expect(ring_with({ ticket: ticket.ticket })).rejects.toMatchObject({ code: 'forbidden' });
    const for_other_queue = sign_queue_worker_control({
      key_scope,
      workspace_id,
      queue_key: 'session:ses_x',
    });
    await expect(ring_with({ api_signature: for_other_queue })).rejects.toMatchObject({
      code: 'queue_worker_control_refused',
    });
    const for_other_scope = sign_queue_worker_control({
      key_scope: 'other_pool',
      workspace_id,
      queue_key,
    });
    await expect(ring_with({ api_signature: for_other_scope })).rejects.toMatchObject({
      code: 'queue_worker_control_refused',
    });
    await ring_with({
      api_signature: sign_queue_worker_control({ key_scope, workspace_id, queue_key }),
    });
  }, 60_000);

  it('returns stored events after a cursor only for runs of the ticket session', async () => {
    const session_id = await open_chat();
    const other_session_id = await open_chat();
    await send(session_id, 'First chat');
    await send(other_session_id, 'Second chat');
    const run_id = await wait_for_completed_run(session_id);
    const other_run_id = await wait_for_completed_run(other_session_id);
    const ticket = await get_ticket(session_id);
    const worker = client.queue_worker.get(ticket.actor_key, {
      params: { ticket: ticket.ticket },
    });

    const events = await worker.events_after({ ticket: ticket.ticket, run_id, after_sequence: 0 });
    expect(events.length).toBeGreaterThan(1);
    expect(events.every((event) => event.run_id === run_id)).toBe(true);
    const tail = await worker.events_after({
      ticket: ticket.ticket,
      run_id,
      after_sequence: events[0]?.sequence ?? 0,
    });
    expect(tail).toEqual(events.slice(1));

    await expect(
      worker.events_after({ ticket: ticket.ticket, run_id: other_run_id, after_sequence: 0 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  }, 60_000);
});

describe('stop for a run in the queue worker', () => {
  it('stops the run in the worker, which releases its own lock before the next message starts', async () => {
    engine_state.timeline.length = 0;
    const session_id = await open_chat();
    await send(session_id, 'Hold until stopped');
    const run_id = await wait_for_run(session_id, 'running');
    await wait_until(() => engine_state.timeline.includes('start:Hold until stopped'));

    const cancel = app.request(`/v1/runs/${run_id}/cancel`, { method: 'POST' });
    await wait_until(async () => Boolean((await read_run(run_id))?.cancel_requested_time));
    expect((await read_session(session_id))?.locked_by_run_id).toBe(run_id);
    await send(session_id, 'After the stop');

    const cancelled = (await (await cancel).json()).data as { run_status: string };
    expect(cancelled.run_status).toBe('cancelled');
    expect((await read_session(session_id))?.locked_by_run_id).not.toBe(run_id);
    expect(worker_log).toContainEqual(
      expect.stringContaining(`cancel_run ${run_id} in session:${session_id}: {"stopping":true`),
    );

    await wait_until(() => engine_state.timeline.includes('exit:After the stop'));
    expect(engine_state.timeline).toEqual([
      'start:Hold until stopped',
      'exit:Hold until stopped',
      'start:After the stop',
      'exit:After the stop',
    ]);
  }, 60_000);

  it('refuses a cancel_run call that the API did not sign for that run', async () => {
    const session_id = await open_chat();
    const ticket = await get_ticket(session_id);
    const [key_scope, workspace_id, queue_key] = ticket.actor_key;
    const worker_for = (params: unknown) => client.queue_worker.get(ticket.actor_key, { params });
    const queue = { key_scope, workspace_id, queue_key };
    const signed_for_y = sign_queue_worker_control({ ...queue, run_id: 'run_y' });
    const signed_for_x = sign_queue_worker_control({ ...queue, run_id: 'run_x' });
    const signed_for_other_queue = sign_queue_worker_control({
      key_scope,
      workspace_id,
      queue_key: 'session:ses_x',
      run_id: 'run_x',
    });

    await expect(
      worker_for({ ticket: ticket.ticket }).cancel_run({
        run_id: 'run_x',
        api_signature: ticket.ticket,
      }),
    ).rejects.toMatchObject({ code: 'queue_worker_control_refused' });
    await expect(
      worker_for({ api_signature: ticket.ticket }).cancel_run({
        run_id: 'run_x',
        api_signature: ticket.ticket,
      }),
    ).rejects.toMatchObject({ code: 'queue_worker_control_refused' });
    await expect(
      worker_for({ api_signature: signed_for_y }).cancel_run({
        run_id: 'run_x',
        api_signature: signed_for_y,
      }),
    ).rejects.toMatchObject({ code: 'queue_worker_control_refused' });
    await expect(
      worker_for({ api_signature: signed_for_x }).cancel_run({
        run_id: 'run_x',
        api_signature: signed_for_other_queue,
      }),
    ).rejects.toMatchObject({ code: 'queue_worker_control_refused' });
    await expect(
      worker_for({ api_signature: signed_for_x }).cancel_run({
        run_id: 'run_x',
        api_signature: signed_for_x,
      }),
    ).resolves.toEqual({ stopping: false, was_running_here: false });
  }, 30_000);
});

async function open_chat() {
  const response = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_title: 'Live test' }),
  });
  return ((await response.json()).data as { session_id: string }).session_id;
}

async function get_ticket(session_id: string) {
  const response = await app.request(`/v1/sessions/${session_id}/stream-ticket`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  return (await response.json()).data as TicketResponse;
}

async function send(session_id: string, message: string) {
  const response = await app.request(`/v1/sessions/${session_id}/queued-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, client_message_id: `client:${crypto.randomUUID()}` }),
  });
  expect(response.status).toBe(202);
}

function open_socket(actor_key: [string, string, string], ticket: string) {
  const connection = client.queue_worker.get(actor_key).connect({ ticket });
  const received: LiveRunEvent[] = [];
  let is_closed = false;
  connection.on('run_event', (event: LiveRunEvent) => received.push(event));
  connection.onClose(() => {
    is_closed = true;
  });
  connection.onError(() => {
    is_closed = true;
  });
  return {
    connection,
    ready: connection.ready,
    received,
    is_closed: () => is_closed,
    dispose: () => connection.dispose(),
  };
}

async function ticket_expiring_in(session_id: string, expires_in_ms: number) {
  const [member] = await db.select().from(workspace_members);
  if (!member) throw new Error('The test database has no member.');
  const issued_at = new Date(Date.now() - run_stream_ticket_lifetime_ms + expires_in_ms);
  const reader = {
    key_scope: 'default',
    workspace_id: member.workspace_id,
    user_id: member.user_id,
    session_id,
  };
  return issue_run_stream_ticket(reader, issued_at).ticket;
}

async function move_session_to_project_of_somebody_else(session_id: string) {
  const session = await read_session(session_id);
  if (!session) throw new Error('The chat does not exist.');
  const project = await create_project(db, {
    workspace_id: session.workspace_id,
    project_name: `Private ${crypto.randomUUID()}`,
    project_access: 'members',
    owner_id: 'usr_somebody_else',
    actor_id: 'usr_somebody_else',
  });
  await db
    .update(sessions)
    .set({ project_id: project.project_id })
    .where(eq(sessions.session_id, session_id));
}

async function connect_error(actor_key: [string, string, string], ticket: string) {
  const connection = client.queue_worker.get(actor_key).connect({ ticket });
  const error = await new Promise<unknown>((resolve) => {
    connection.onError((reason) => resolve(reason));
    connection.ready.then(() => resolve(null), resolve);
  });
  await connection.dispose();
  return error;
}

async function set_membership(member_status: string) {
  const members = await db
    .update(workspace_members)
    .set({ member_status })
    .returning({ user_id: workspace_members.user_id });
  expect(members).toHaveLength(1);
}

async function read_run(run_id: string) {
  const [run] = await db.select().from(runs).where(eq(runs.run_id, run_id));
  return run;
}

async function read_session(session_id: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.session_id, session_id));
  return session;
}

async function wait_for_run(session_id: string, run_status: string) {
  let run_id = '';
  await wait_until(async () => {
    const [run] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.session_id, session_id), eq(runs.run_status, run_status)));
    run_id = run?.run_id ?? '';
    return Boolean(run);
  });
  return run_id;
}

function wait_for_completed_run(session_id: string) {
  return wait_for_run(session_id, 'completed');
}

async function wait_until(check: () => boolean | Promise<boolean>, timeout_ms = 20_000) {
  const deadline = Date.now() + timeout_ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function fetch_with_model_reply(input: string | URL | Request, init?: RequestInit) {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(openai_responses_url)) return real_fetch(input, init);
  const text = latest_user_text(typeof init?.body === 'string' ? init.body : '{}');
  engine_state.timeline.push(`start:${text}`);
  const body = new ReadableStream<Uint8Array>({
    start: (controller) =>
      write_model_reply(text, init?.signal ?? undefined, (event) =>
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
      ).then(() => controller.close()),
  });
  return Promise.resolve(
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  );
}

async function write_model_reply(
  text: string,
  signal: AbortSignal | undefined,
  send: (event: ModelStreamEvent) => void,
) {
  send({ type: 'response.created', response: { id: 'resp_test' } });
  if (text === 'Hold until stopped') {
    while (!signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, engine_state.unwind_ms));
    engine_state.timeline.push(`exit:${text}`);
    return;
  }
  const item = { type: 'message', id: 'msg_test', role: 'assistant', content: [] };
  send({ type: 'response.output_item.added', output_index: 0, item });
  let accumulated_text = '';
  for (const word of ['Streamed ', 'word ', 'by ', 'word']) {
    accumulated_text += word;
    send({ type: 'response.output_text.delta', output_index: 0, delta: word });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const content = [{ type: 'output_text', text: accumulated_text }];
  send({ type: 'response.output_item.done', output_index: 0, item: { ...item, content } });
  engine_state.timeline.push(`exit:${text}`);
  const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
  send({ type: 'response.completed', response: { id: 'resp_test', status: 'completed', usage } });
}

function latest_user_text(request_body: string) {
  const request = model_request_schema.parse(JSON.parse(request_body));
  const message = [...request.input].reverse().find((entry) => entry.role === 'user');
  if (typeof message?.content === 'string') return message.content;
  return (message?.content ?? []).flatMap((part) => (part.text ? [part.text] : [])).join('\n');
}
