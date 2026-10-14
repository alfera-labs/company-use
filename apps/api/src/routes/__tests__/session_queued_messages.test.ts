import type { LlmResolvedRequest } from '@agent-core/llm_gateway';
import type { RuntimeAgentEngine } from '@agent-core/runs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const engine = {
  user_texts: [] as string[],
  is_holding: false,
};

function hold_the_next_run() {
  engine.is_holding = true;
}

function release_held_run() {
  engine.is_holding = false;
}

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
    if (latest_user_text === 'Hold until released') {
      while (engine.is_holding && !input.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    yield {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Did: ${latest_user_text}` }],
      },
    };
  },
});

vi.mock('@agent-core/llm_gateway/adapters/pi_ai_adapter', () => ({
  create_pi_ai_adapter: () => ({
    async generate_text(input: LlmResolvedRequest) {
      const text = '{"title":"Queued chat"}';
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
  release_held_run();
  vi.unstubAllEnvs();
  vi.resetModules();
});

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

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
  const app = create_app(db);
  const created = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_title: 'Queue test' }),
  });
  const session = (await created.json()).data as {
    session_id: string;
    workspace_id: string;
    agent_id: string;
  };
  return { app, db, session };
}

function send(app: App, session_id: string, message: string, client_message_id: string) {
  return app.request(`/v1/sessions/${session_id}/queued-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, client_message_id }),
  });
}

async function list_queued(app: App, session_id: string) {
  const response = await app.request(`/v1/sessions/${session_id}/queued-messages`);
  return (await response.json()).data as Array<{
    job_id: string;
    client_message_id: string;
    preview_text: string;
    state: string;
    waiting_reason: string;
  }>;
}

async function list_runs(app: App, session_id: string) {
  const response = await app.request(`/v1/sessions/${session_id}/runs`);
  return (await response.json()).data as Array<{ run_id: string; run_status: string }>;
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

async function wait_for_running_run(app: App, session_id: string) {
  await wait_until(
    async () => engine.user_texts,
    (texts) => texts.includes('Hold until released'),
  );
  return wait_until(
    () => list_runs(app, session_id),
    (runs) => runs.some((run) => run.run_status === 'running'),
  );
}

async function read_message_jobs(db: Awaited<ReturnType<typeof open_chat>>['db']) {
  const { event_jobs } = await import('@coworker/core/db/schema');
  const { asc, eq } = await import('drizzle-orm');
  return db
    .select()
    .from(event_jobs)
    .where(eq(event_jobs.job_handler, 'session_agent_message'))
    .orderBy(asc(event_jobs.created_time));
}

describe('queued chat messages', () => {
  it('runs two messages sent during a run as two runs, one after the other, in order', async () => {
    const { app, db, session } = await open_chat();
    hold_the_next_run();

    const first = await send(app, session.session_id, 'Hold until released', 'draft-1');
    expect(first.status).toBe(202);
    await wait_for_running_run(app, session.session_id);
    const second = await send(app, session.session_id, 'Second message', 'draft-2');
    const third = await send(app, session.session_id, 'Third message', 'draft-3');
    expect([second.status, third.status]).toEqual([202, 202]);
    const second_job = (await second.json()).data;
    expect(second_job).toMatchObject({
      session_id: session.session_id,
      waiting_reason: 'session_busy',
    });

    const repeated = await send(app, session.session_id, 'Second message', 'draft-2');
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).data.job_id).toBe(second_job.job_id);

    expect(await list_queued(app, session.session_id)).toEqual([
      expect.objectContaining({
        client_message_id: 'draft-2',
        preview_text: 'Second message',
        state: 'queued',
        waiting_reason: 'session_busy',
      }),
      expect.objectContaining({
        client_message_id: 'draft-3',
        preview_text: 'Third message',
        state: 'queued',
        waiting_reason: 'session_busy',
      }),
    ]);

    release_held_run();
    const runs = await wait_until(
      () => list_runs(app, session.session_id),
      (listed) => listed.length === 3 && listed.every((run) => run.run_status === 'completed'),
    );
    expect(engine.user_texts).toEqual(['Hold until released', 'Second message', 'Third message']);
    const jobs = await wait_until(
      () => read_message_jobs(db),
      (listed) => listed.every((job) => job.job_status === 'done'),
    );
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((job) => job.run_id)).size).toBe(3);
    expect(new Set(runs.map((run) => run.run_id))).toEqual(new Set(jobs.map((job) => job.run_id)));

    const messages = (
      await (await app.request(`/v1/sessions/${session.session_id}/messages`)).json()
    ).data.items as Array<{ message_role: string; source_metadata: Record<string, unknown> }>;
    expect(
      messages
        .filter((message) => message.message_role === 'user')
        .map((message) => message.source_metadata.client_message_id),
    ).toEqual(['draft-1', 'draft-2', 'draft-3']);
    expect(await list_queued(app, session.session_id)).toEqual([]);
  }, 45_000);

  it('says a message in an idle chat is starting, and one behind it waits for the chat', async () => {
    vi.stubEnv('EVENT_JOB_DISPATCH_MODE', 'rivet');
    const { app, session } = await open_chat();

    const first = await send(app, session.session_id, 'First message', 'draft-1');
    expect(first.status).toBe(202);
    expect((await first.json()).data.waiting_reason).toBe('starting');
    await send(app, session.session_id, 'Second message', 'draft-2');

    expect(await list_queued(app, session.session_id)).toEqual([
      expect.objectContaining({ client_message_id: 'draft-1', waiting_reason: 'starting' }),
      expect.objectContaining({ client_message_id: 'draft-2', waiting_reason: 'session_busy' }),
    ]);
  });

  it('removes a message while it waits, and refuses once it started', async () => {
    const { app, db, session } = await open_chat();
    hold_the_next_run();

    const first = (await (await send(app, session.session_id, 'Hold until released', 'd1')).json())
      .data;
    await wait_for_running_run(app, session.session_id);
    const second = (await (await send(app, session.session_id, 'Never mind', 'd2')).json()).data;

    const removed = await app.request(
      `/v1/sessions/${session.session_id}/queued-messages/${second.job_id}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(200);
    expect(await list_queued(app, session.session_id)).toEqual([]);
    const removed_again = await app.request(
      `/v1/sessions/${session.session_id}/queued-messages/${second.job_id}`,
      { method: 'DELETE' },
    );
    expect(removed_again.status).toBe(200);

    const too_late = await app.request(
      `/v1/sessions/${session.session_id}/queued-messages/${first.job_id}`,
      { method: 'DELETE' },
    );
    expect(too_late.status).toBe(409);

    release_held_run();
    await wait_until(
      () => list_runs(app, session.session_id),
      (runs) => runs.length === 1 && runs[0]?.run_status === 'completed',
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(engine.user_texts).toEqual(['Hold until released']);
    expect((await read_message_jobs(db)).map((job) => job.job_status)).toEqual([
      'done',
      'cancelled',
    ]);
  }, 45_000);

  it('pauses every waiting message on stop, and sends them in order on resume', async () => {
    const { app, session } = await open_chat();
    hold_the_next_run();

    await send(app, session.session_id, 'Hold until released', 'd1');
    const [held_run] = await wait_for_running_run(app, session.session_id);
    await send(app, session.session_id, 'Paused one', 'd2');
    await send(app, session.session_id, 'Paused two', 'd3');

    const stopped = await app.request(`/v1/runs/${held_run?.run_id}/cancel`, { method: 'POST' });
    expect(stopped.status).toBe(200);
    expect(await list_queued(app, session.session_id)).toEqual([
      expect.objectContaining({
        preview_text: 'Paused one',
        state: 'paused',
        waiting_reason: 'paused',
      }),
      expect.objectContaining({
        preview_text: 'Paused two',
        state: 'paused',
        waiting_reason: 'paused',
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(engine.user_texts).toEqual(['Hold until released']);

    const resumed = await app.request(`/v1/sessions/${session.session_id}/queued-messages/resume`, {
      method: 'POST',
    });
    expect((await resumed.json()).data.resumed_job_ids).toHaveLength(2);
    await wait_until(
      () => list_runs(app, session.session_id),
      (runs) => runs.filter((run) => run.run_status === 'completed').length === 2,
    );
    expect(engine.user_texts).toEqual(['Hold until released', 'Paused one', 'Paused two']);
  }, 45_000);

  it('queues a notification answer for the same chat behind the messages already waiting', async () => {
    const { app, db, session } = await open_chat();
    const { enqueue_notification_answer } = await import(
      '@runtime-platform/events/notification_answer_job'
    );
    hold_the_next_run();

    await send(app, session.session_id, 'Hold until released', 'd1');
    await wait_for_running_run(app, session.session_id);
    await send(app, session.session_id, 'Queued before the answer', 'd2');
    const answer = await enqueue_notification_answer(db, {
      workspace_id: session.workspace_id,
      notification_event_id: 'evt_notification_1',
      session_id: session.session_id,
      answered_by: 'user_1',
      answer: 'yes',
    });
    expect(answer).toMatchObject({ enqueued: true, queue_key: `session:${session.session_id}` });

    release_held_run();
    await wait_until(
      () => list_runs(app, session.session_id),
      (runs) => runs.length === 3 && runs.every((run) => run.run_status === 'completed'),
    );
    expect(engine.user_texts).toEqual([
      'Hold until released',
      'Queued before the answer',
      'Yes, go ahead.',
    ]);
  }, 45_000);

  it('cancels waiting messages when the chat is archived, and never runs one for a deleted chat', async () => {
    const { app, db, session } = await open_chat();
    const { acquire_session_execution_lock } = await import('@coworker/core/db/queries/sessions');
    const { enqueue_event_jobs } = await import('@coworker/core/db/queries/events');
    const { run_queue_jobs } = await import('@coworker/jobs');
    const { find_event_job_handler } = await import('@coworker/runtime-platform');
    hold_the_next_run();

    await send(app, session.session_id, 'Hold until released', 'd1');
    await wait_for_running_run(app, session.session_id);
    await send(app, session.session_id, 'After the archive', 'd2');

    expect(
      (await app.request(`/v1/sessions/${session.session_id}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect((await read_message_jobs(db)).map((job) => job.job_status)).toEqual([
      'running',
      'cancelled',
    ]);
    release_held_run();
    await wait_until(
      () => read_message_jobs(db),
      (jobs) => jobs[0]?.job_status === 'done',
    );

    await enqueue_event_jobs(db, {
      workspace_id: session.workspace_id,
      source: 'web_chat',
      source_event_id: `${session.session_id}:late`,
      event_type: 'session.message_sent',
      queue_key: `session:${session.session_id}`,
      actor_key: 'user_1',
      event_body: {
        version: 1,
        session_id: session.session_id,
        actor_user_id: 'user_1',
        message: 'Revive the chat',
        client_message_id: 'late',
      },
      event_jobs: [
        {
          job_handler: 'session_agent_message',
          metadata: { blocks_later_subject_jobs: true, claimed_alone: true },
        },
      ],
    });
    await run_queue_jobs(
      db,
      { workspace_id: session.workspace_id, queue_key: `session:${session.session_id}` },
      find_event_job_handler,
    );
    const late_job = (await read_message_jobs(db)).at(-1);
    expect(late_job).toMatchObject({
      job_status: 'done',
      run_id: null,
      result_data: expect.objectContaining({ ran: false, code: 'session_unavailable' }),
    });
    expect(engine.user_texts).toEqual(['Hold until released']);
    expect(
      await acquire_session_execution_lock(db, {
        workspace_id: session.workspace_id,
        session_id: session.session_id,
        run_id: 'run_after_archive',
        actor_id: 'user_1',
      }),
    ).toBeNull();
  }, 45_000);

  it('withdraws a run parked on a question before the next message starts', async () => {
    const { app, db, session } = await open_chat();
    const { create_run, get_run } = await import('@coworker/core/db/queries/sessions');
    const { create_tool_policy_wait, get_tool_policy_wait } = await import(
      '@coworker/core/db/queries/event_waits'
    );
    const { runs } = await import('@coworker/core/db/schema');
    const { eq } = await import('drizzle-orm');
    const parked = await create_run(db, {
      workspace_id: session.workspace_id,
      session_id: session.session_id,
      agent_id: session.agent_id,
      trigger_type: 'user_message',
      actor_id: 'user_1',
    });
    await db.update(runs).set({ run_status: 'waiting' }).where(eq(runs.run_id, parked.run_id));
    const { event_job: question } = await create_tool_policy_wait(db, {
      workspace_id: session.workspace_id,
      queue_key: 'wait:tool_policy:parked',
      actor_id: 'user_1',
      wait: {
        version: 2,
        kind: 'tool_policy_approval',
        session_id: session.session_id,
        source_run_id: parked.run_id,
        calls: [{ tool_call_id: 'tcall_parked', input_sha256: 'hash' }],
        requested_by: 'user_1',
        eligible_user_ids: ['user_1'],
      },
    });

    expect((await send(app, session.session_id, 'Do something else', 'd1')).status).toBe(202);
    await wait_until(
      () => list_runs(app, session.session_id),
      (listed) =>
        listed.some((run) => run.run_id !== parked.run_id && run.run_status === 'completed'),
    );

    expect((await get_run(db, session.workspace_id, parked.run_id))?.run_status).toBe('cancelled');
    expect(
      await get_tool_policy_wait(db, {
        workspace_id: session.workspace_id,
        job_id: question.job_id,
      }),
    ).toMatchObject({ job_status: 'done', result_data: { withdrawn: 'run_cancelled' } });
    expect(engine.user_texts).toEqual(['Do something else']);
  }, 45_000);

  it('starts web chat at once while background work holds the whole workspace run limit', async () => {
    const { app, db, session } = await open_chat();
    const { enqueue_event_jobs } = await import('@coworker/core/db/queries/events');
    const { set_workspace_max_concurrent_runs } = await import(
      '@coworker/core/db/queries/workspace_run_cap'
    );
    const { claim_ready_event_jobs_for_queue } = await import('@coworker/jobs');
    await set_workspace_max_concurrent_runs(db, {
      workspace_id: session.workspace_id,
      max_concurrent_runs: 1,
      actor_id: 'user_1',
    });
    await enqueue_event_jobs(db, {
      workspace_id: session.workspace_id,
      source: 'test',
      source_event_id: 'background-run',
      event_type: 'message',
      queue_key: 'slack:C1:background',
      actor_key: 'user_1',
      event_jobs: [{ job_handler: 'slack_agent_message' }],
    });
    const background = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: session.workspace_id,
      queue_key: 'slack:C1:background',
      worker_id: 'background-worker',
      lock_milliseconds: 600_000,
    });
    expect(background).toHaveLength(1);
    const other = (
      await (
        await app.request('/v1/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_title: 'Another chat' }),
        })
      ).json()
    ).data as { session_id: string };
    hold_the_next_run();

    await send(app, session.session_id, 'Hold until released', 'd1');
    await wait_for_running_run(app, session.session_id);
    await send(app, session.session_id, 'Same chat, second', 'd2');
    await send(app, other.session_id, 'Another chat, right away', 'o1');
    await wait_until(
      () => list_runs(app, other.session_id),
      (runs) => runs[0]?.run_status === 'completed',
    );
    expect(engine.user_texts).toEqual(['Hold until released', 'Another chat, right away']);

    release_held_run();
    await wait_until(
      () => list_runs(app, session.session_id),
      (runs) => runs.length === 2 && runs.every((run) => run.run_status === 'completed'),
    );
    expect(engine.user_texts).toEqual([
      'Hold until released',
      'Another chat, right away',
      'Same chat, second',
    ]);
  }, 45_000);
});

type Db = Awaited<ReturnType<typeof open_chat>>['db'];
type Scope = { session_id: string; workspace_id: string };
type NotSent = {
  job_id: string;
  client_message_id: string | null;
  state: string;
  reason_code: string;
  reason: string;
  retry_message: { message?: string; content?: unknown[] } | null;
};

async function list_not_sent(app: App, session_id: string) {
  const response = await app.request(`/v1/sessions/${session_id}/queued-messages`);
  const listed = (await response.json()).data as NotSent[];
  return listed.filter((message) => message.state === 'not_sent');
}

async function read_job(db: Db, job_id: string) {
  const { event_jobs } = await import('@coworker/core/db/schema');
  const { eq } = await import('drizzle-orm');
  const [job] = await db.select().from(event_jobs).where(eq(event_jobs.job_id, job_id));
  if (!job) throw new Error(`No job ${job_id}`);
  return job;
}

function message_body(scope: Scope, text: string, client_message_id: string) {
  return {
    version: 1,
    session_id: scope.session_id,
    actor_user_id: 'user_1',
    message: text,
    client_message_id,
  };
}

async function enqueue_message(
  db: Db,
  scope: Scope,
  input: { client_message_id: string; event_body: Record<string, unknown> },
) {
  const { enqueue_event_jobs } = await import('@coworker/core/db/queries/events');
  const result = await enqueue_event_jobs(db, {
    workspace_id: scope.workspace_id,
    source: 'web_chat',
    source_event_id: `${scope.session_id}:${input.client_message_id}`,
    event_type: 'session.message_sent',
    queue_key: `session:${scope.session_id}`,
    actor_key: 'user_1',
    event_body: input.event_body,
    event_jobs: [
      {
        job_handler: 'session_agent_message',
        metadata: {
          blocks_later_subject_jobs: true,
          claimed_alone: true,
          client_message_id: input.client_message_id,
        },
      },
    ],
  });
  const job = result.event_jobs[0];
  if (!job) throw new Error('No job queued');
  return job;
}

async function run_session_queue(db: Db, scope: Scope) {
  const { run_queue_jobs } = await import('@coworker/jobs');
  const { find_event_job_handler } = await import('@coworker/runtime-platform');
  await run_queue_jobs(
    db,
    { workspace_id: scope.workspace_id, queue_key: `session:${scope.session_id}` },
    find_event_job_handler,
  );
}

describe('chat messages that were not sent', () => {
  it('lists a message that ended without a run, with a reason a person can read', async () => {
    const { app, db, session } = await open_chat();
    const { create_id, id_prefixes } = await import('@coworker/shared');
    const { claim_ready_event_jobs_for_queue, recover_expired_event_jobs } = await import(
      '@coworker/jobs'
    );
    const { sessions } = await import('@coworker/core/db/schema');
    const { eq } = await import('drizzle-orm');
    const scope = { session_id: session.session_id, workspace_id: session.workspace_id };

    const missing_file = await app.request(`/v1/sessions/${session.session_id}/queued-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Read the plan',
        content: [{ type: 'file', file_id: create_id(id_prefixes.artifact), name: 'plan.pdf' }],
        client_message_id: 'attachment',
      }),
    });
    expect(missing_file.status).toBe(202);
    await wait_until(
      () => list_not_sent(app, session.session_id),
      (listed) => listed.some((message) => message.client_message_id === 'attachment'),
    );
    await enqueue_message(db, scope, {
      client_message_id: 'unreadable',
      event_body: { version: 99, message: 'From the future' },
    });
    await run_session_queue(db, scope);
    await enqueue_message(db, scope, {
      client_message_id: 'failed',
      event_body: message_body(scope, 'Lost its worker', 'failed'),
    });
    const claimed = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: scope.workspace_id,
      queue_key: `session:${scope.session_id}`,
      worker_id: 'worker-that-dies',
      lock_milliseconds: 1,
    });
    expect(claimed).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recover_expired_event_jobs(db, { max_interruptions: 1 });
    const set_status = (session_status: string) =>
      db.update(sessions).set({ session_status }).where(eq(sessions.session_id, scope.session_id));
    await set_status('deleted');
    await enqueue_message(db, scope, {
      client_message_id: 'deleted',
      event_body: message_body(scope, 'Into a deleted chat', 'deleted'),
    });
    await run_session_queue(db, scope);
    await set_status('active');

    const not_sent = await list_not_sent(app, session.session_id);
    expect(
      not_sent.map((message) => [message.client_message_id, message.reason_code, message.reason]),
    ).toEqual([
      ['attachment', 'attachment_unavailable', 'An attachment is no longer available'],
      ['unreadable', 'could_not_be_read', 'The message could not be read'],
      ['failed', 'failed', 'Sending failed'],
      ['deleted', 'chat_deleted', 'The chat was deleted'],
    ]);
    expect(not_sent[1]?.retry_message).toBeNull();
    expect(engine.user_texts).toEqual([]);
  }, 45_000);

  it('retries a message whose worker died as a new job with the same words and the same stored image', async () => {
    const { app, db, session } = await open_chat();
    const { events } = await import('@coworker/core/db/schema');
    const { eq } = await import('drizzle-orm');
    const { claim_ready_event_jobs_for_queue, recover_expired_event_jobs } = await import(
      '@coworker/jobs'
    );
    const { create_in_memory_object_storage, set_memory_import_object_storage_for_tests } =
      await import('@coworker/runtime-platform');
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const scope = { session_id: session.session_id, workspace_id: session.workspace_id };
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const sent = await app.request(`/v1/sessions/${session.session_id}/queued-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Look at this',
        images: [{ data: png, mime_type: 'image/png' }],
        client_message_id: 'with-image',
      }),
    });
    const sent_job = await read_job(db, (await sent.json()).data.job_id as string);
    await wait_until(
      () => list_runs(app, session.session_id),
      (runs) => runs.length === 1 && runs.every((run) => run.run_status === 'completed'),
    );
    const [sent_event] = await db
      .select()
      .from(events)
      .where(eq(events.event_id, sent_job.event_id ?? ''));
    const lost = await enqueue_message(db, scope, {
      client_message_id: 'lost-its-worker',
      event_body: { ...sent_event?.event_body, client_message_id: 'lost-its-worker' },
    });
    const claimed = await claim_ready_event_jobs_for_queue(db, {
      workspace_id: scope.workspace_id,
      queue_key: `session:${scope.session_id}`,
      worker_id: 'worker-that-dies',
      lock_milliseconds: 1,
    });
    expect(claimed).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recover_expired_event_jobs(db, { max_interruptions: 1 });

    const [not_sent] = await list_not_sent(app, session.session_id);
    expect(not_sent?.job_id).toBe(lost.job_id);
    expect(not_sent?.reason_code).toBe('failed');
    expect(not_sent?.retry_message).toEqual({
      message: 'Look at this',
      content: [
        {
          type: 'file',
          file_id: expect.stringMatching(/^art_/),
          mime_type: 'image/png',
          read_as: 'image',
        },
      ],
    });

    const retried = await app.request(`/v1/sessions/${session.session_id}/queued-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...not_sent?.retry_message, client_message_id: 'retry-1' }),
    });
    expect(retried.status).toBe(202);
    for (const part of [
      { type: 'file', path: '/etc/hosts', read_as: 'text' },
      { type: 'file', file_id: 'ses_not_a_file', read_as: 'image' },
    ]) {
      const refused = await app.request(`/v1/sessions/${session.session_id}/queued-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Read it', content: [part], client_message_id: 'bad' }),
      });
      expect(refused.status).toBe(422);
    }
    const retry_job_id = (await retried.json()).data.job_id as string;
    expect(retry_job_id).not.toBe(lost.job_id);
    await wait_until(
      () => list_runs(app, session.session_id),
      (runs) => runs.length === 2 && runs.every((run) => run.run_status === 'completed'),
    );
    expect(engine.user_texts).toEqual(['Look at this', 'Look at this']);
    const retry_job = await read_job(db, retry_job_id);
    const [retry_event] = await db
      .select()
      .from(events)
      .where(eq(events.event_id, retry_job.event_id ?? ''));
    expect((retry_event?.event_body as { content?: unknown[] }).content).toEqual(
      not_sent?.retry_message?.content,
    );
  }, 45_000);

  it('hides a removed message for good, and stops showing any after 15 minutes', async () => {
    const { app, db, session } = await open_chat();
    const { event_jobs } = await import('@coworker/core/db/schema');
    const { eq } = await import('drizzle-orm');
    const scope = { session_id: session.session_id, workspace_id: session.workspace_id };
    const removed = await enqueue_message(db, scope, {
      client_message_id: 'removed',
      event_body: { version: 99 },
    });
    await run_session_queue(db, scope);
    const old = await enqueue_message(db, scope, {
      client_message_id: 'old',
      event_body: { version: 99 },
    });
    await run_session_queue(db, scope);
    expect((await list_not_sent(app, session.session_id)).map((m) => m.job_id)).toEqual([
      removed.job_id,
      old.job_id,
    ]);

    const response = await app.request(
      `/v1/sessions/${session.session_id}/queued-messages/${removed.job_id}`,
      { method: 'DELETE' },
    );
    expect(response.status).toBe(200);
    expect((await read_job(db, removed.job_id)).metadata.dismissed_by_user).toBe(true);
    await db
      .update(event_jobs)
      .set({ last_updated_time: new Date(Date.now() - 16 * 60_000) })
      .where(eq(event_jobs.job_id, old.job_id));

    expect(await list_not_sent(app, session.session_id)).toEqual([]);
  }, 45_000);
});
