import { randomUUID } from 'node:crypto';
import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import type { RuntimeToolBatchCall } from '@agent-core/tools';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { set_policy } from '@coworker/core/db/queries/policies';
import {
  create_run,
  create_run_messages,
  create_session,
  create_tool_call_started,
  request_run_cancellation,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import {
  event_jobs,
  run_messages,
  runs,
  sessions,
  tool_calls,
  usage_records,
  workspaces,
} from '@coworker/core/db/schema';
import { recover_expired_event_jobs, run_queue_jobs } from '@coworker/jobs';
import {
  api_session_event_source,
  api_session_turn_event_type,
  api_session_turn_job_handler,
} from '@runtime-platform/events/api_session_turn_job';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { AgentRunStoppedError } from '@runtime-platform/orchestrator/agent_run_stopped';
import { record_runtime_event } from '@runtime-platform/orchestrator/event_persistence';
import {
  cancel_agent_run,
  start_agent_run,
} from '@runtime-platform/orchestrator/runtime_orchestrator';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { store_tool_call_output } from '@runtime-platform/tools/stored_tool_result';
import { restore_run_message_tool_results } from '@runtime-platform/tools/stored_tool_result_reads';
import {
  tool_result_v2_from_platform_result,
  tool_result_v2_from_runtime_result,
} from '@runtime-platform/tools/stored_tool_result_shape';
import { execute_runtime_tool } from '@runtime-platform/tools/tool_execution_service';
import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const engine = {
  turns: [] as Array<(input: RuntimeAgentEngineInput) => AsyncIterable<RuntimeAgentEngineEvent>>,
  inputs: [] as RuntimeAgentEngineInput[],
};

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
  configure_agent_engine(() => ({
    engine_name: 'agent-core/pi/resume-test',
    run(input: RuntimeAgentEngineInput) {
      engine.inputs.push(input);
      const turn = engine.turns.shift();
      if (!turn) throw new Error('The test did not script this model call.');
      return turn(input);
    },
  }));
});

afterEach(() => {
  configure_agent_engine(create_pi_engine);
  engine.turns.length = 0;
  engine.inputs.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type ToolCallPart = {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

function assistant_asks_for(call: ToolCallPart): RuntimeAgentEngineEvent {
  return { type: 'message', message: { role: 'assistant', content: [call] } };
}

function assistant_says(text: string): RuntimeAgentEngineEvent {
  return {
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function batch_of(call: ToolCallPart): RuntimeToolBatchCall[] {
  return [{ tool_call_id: call.id, tool_name: call.name, input: call.arguments }];
}

function run_tool(input: RuntimeAgentEngineInput, call: ToolCallPart) {
  const tool = input.tools.find((candidate) => candidate.tool_name === call.name);
  if (!tool?.execute) throw new Error(`The run has no ${call.name} tool.`);
  return tool.execute(call.arguments, {
    run_key: input.run_key,
    ...(input.session_key ? { session_key: input.session_key } : {}),
    tool_call_id: call.id,
    ...(input.environment ? { environment: input.environment } : {}),
    signal: input.signal,
    metadata: {},
  });
}

async function seed_workspace(db: Database) {
  await seed_runtime_tool_catalog(db);
  const workspace = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: workspace.workspace_id,
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  });
  return { ...workspace, session_id: session.session_id };
}

async function list_messages(db: Database, run_id: string) {
  return db.query.run_messages.findMany({
    where: eq(run_messages.run_id, run_id),
    orderBy: [asc(run_messages.message_sequence)],
  });
}

async function read_session(db: Database, session_id: string) {
  return db.query.sessions.findFirst({ where: eq(sessions.session_id, session_id) });
}

describe('the assistant turn that asks for tools', () => {
  it('is saved before any of its tools run', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const call: ToolCallPart = {
      type: 'tool_call',
      id: 'call_list_1',
      name: 'workspace-list_files',
      arguments: { path: '.' },
    };
    const saved_when_tools_ran: boolean[] = [];
    engine.turns.push(async function* (input) {
      for (let block = 0; block < 40; block += 1) {
        yield { type: 'progress', label: 'pi.thinking_end', content: `thought ${block}` };
      }
      yield assistant_asks_for(call);
      await input.decide_tool_batch?.(batch_of(call));
      const saved = await db.query.run_messages.findMany({
        where: and(
          eq(run_messages.run_id, input.run_key),
          eq(run_messages.message_role, 'assistant'),
        ),
      });
      saved_when_tools_ran.push(JSON.stringify(saved).includes(call.id));
      await run_tool(input, call);
      yield assistant_says('Listed.');
    });

    const run = await start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      user_message: 'What is in the workspace?',
      actor_id: seeded.user_id,
    });

    expect(run.run_status).toBe('completed');
    expect(saved_when_tools_ran).toEqual([true]);
  }, 60_000);
});

type SentEmail = { id: string; created_at: string; tags: Array<{ name: string; value: string }> };
const sent_email_body_schema = z.object({
  tags: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});

function stub_resend(after_send: () => Promise<Response>) {
  const sent: SentEmail[] = [];
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const path = new URL(url).pathname;
      if (init?.method === 'POST' && path === '/emails') {
        const body = sent_email_body_schema.parse(JSON.parse(init.body ?? '{}'));
        sent.push({
          id: `email_${sent.length + 1}`,
          created_at: new Date().toISOString(),
          tags: body.tags ?? [],
        });
        return after_send();
      }
      if (path === '/emails') {
        const data = [...sent].reverse().map(({ id, created_at }) => ({ id, created_at }));
        return Response.json({ object: 'list', has_more: false, data });
      }
      const email = sent.find((candidate) => path === `/emails/${candidate.id}`);
      if (email) return Response.json({ ...email, message_id: `<${email.id}@test>` });
      throw new Error(`Unexpected request to ${url}`);
    }),
  );
  return sent;
}

async function allow_email(db: Database, seeded: Awaited<ReturnType<typeof seed_workspace>>) {
  await db
    .update(workspaces)
    .set({ inbound_email_username: 'acme' })
    .where(eq(workspaces.workspace_id, seeded.workspace_id));
  await set_policy(db, {
    workspace_id: seeded.workspace_id,
    resource_type: 'node',
    resource_id: 'email-send-1',
    scope_type: 'workspace',
    scope_id: seeded.workspace_id,
    policy_mode: 'allow',
    actor_id: seeded.user_id,
  });
}

async function seed_session_turn_job(
  db: Database,
  seeded: Awaited<ReturnType<typeof seed_workspace>>,
) {
  await allow_email(db, seeded);
  const queue_key = `session:${seeded.session_id}`;
  const queued = await enqueue_event_jobs(db, {
    workspace_id: seeded.workspace_id,
    source: api_session_event_source,
    source_event_id: 'turn-resume-1',
    event_type: api_session_turn_event_type,
    queue_key,
    actor_key: 'key_test',
    event_body: {
      session_turn_payload_version: 1,
      session_id: seeded.session_id,
      user_content: [{ type: 'text', text: 'Email the founder the rain backup plan.' }],
      api_key_id: 'key_test',
    },
    event_jobs: [{ job_handler: api_session_turn_job_handler }],
  });
  const job = queued.event_jobs[0];
  if (!job || !queued.event) throw new Error('Failed to enqueue the session turn job.');
  return { queue_key, job, event: queued.event };
}

describe('a run whose worker stopped right after an email went out', () => {
  it('stops quietly, then the next claim continues the same run and does not send twice', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const { queue_key, job, event } = await seed_session_turn_job(db, seeded);
    const claim = new AbortController();
    const sent = stub_resend(() => {
      claim.abort(new Error('The claim on this job was lost.'));
      return new Promise<Response>(() => undefined);
    });
    const email: ToolCallPart = {
      type: 'tool_call',
      id: 'call_email_1',
      name: 'email-send-1',
      arguments: { to: ['founder@runtime.local'], subject: 'Rain backup', message: 'Tent B.' },
    };
    engine.turns.push(async function* (input) {
      yield assistant_asks_for(email);
      await input.decide_tool_batch?.(batch_of(email));
      void run_tool(input, email);
      await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
    });

    await expect(
      find_event_job_handler(api_session_turn_job_handler)?.run({
        db,
        workspace_id: seeded.workspace_id,
        queue_key,
        event_jobs: [job],
        events: [event],
        heartbeat: async () => undefined,
        record_progress: async () => undefined,
        run_queue_jobs_in_the_background: () => undefined,
        record_started_run_id: async (run_id) => {
          await db.update(event_jobs).set({ run_id }).where(eq(event_jobs.job_id, job.job_id));
        },
        signal: claim.signal,
      }),
    ).rejects.toBeInstanceOf(AgentRunStoppedError);

    const started = await db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, job.job_id),
    });
    const run_id = started?.run_id;
    if (!run_id) throw new Error('The first claim recorded no run.');
    const stopped_run = await db.query.runs.findFirst({ where: eq(runs.run_id, run_id) });
    const unfinished = await db.query.tool_calls.findFirst({
      where: eq(tool_calls.run_id, run_id),
    });
    expect(stopped_run?.run_status).toBe('running');
    expect(unfinished?.tool_status).toBe('executing');
    expect(unfinished?.output_data).toBeNull();
    expect(sent).toHaveLength(1);
    expect((await read_session(db, seeded.session_id))?.locked_by_run_id).toBe(run_id);

    await db
      .update(sessions)
      .set({ lock_expires_time: new Date(Date.now() - 1_000) })
      .where(eq(sessions.session_id, seeded.session_id));
    await db
      .update(event_jobs)
      .set({
        job_status: 'queued',
        lock_token: null,
        locked_by: null,
        locked_until: null,
        available_time: new Date(Date.now() - 1_000),
      })
      .where(eq(event_jobs.job_id, job.job_id));
    engine.turns.push(async function* () {
      yield assistant_says('Sent the rain backup plan to the founder.');
    });

    await run_queue_jobs(
      db,
      { workspace_id: seeded.workspace_id, queue_key },
      find_event_job_handler,
    );

    const finished_job = await db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, job.job_id),
    });
    expect(finished_job?.job_status).toBe('done');
    expect(finished_job?.run_id).toBe(run_id);
    const session_runs = await db.query.runs.findMany({
      where: eq(runs.session_id, seeded.session_id),
    });
    expect(session_runs.map((run) => [run.run_id, run.run_status])).toEqual([
      [run_id, 'completed'],
    ]);
    const messages = await list_messages(db, run_id);
    expect(messages.filter((message) => message.message_role === 'user')).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const rows = await db.query.tool_calls.findMany({ where: eq(tool_calls.run_id, run_id) });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_call_id).toBe(unfinished?.tool_call_id);
    expect(rows[0]?.tool_status).toBe('completed');
    expect(JSON.stringify(rows[0]?.output_data)).toContain('already_done');
    const continued = engine.inputs.at(-1);
    expect(
      continued?.messages.some(
        (message) => message.role === 'tool' && JSON.stringify(message).includes(email.id),
      ),
    ).toBe(true);
    expect((await read_session(db, seeded.session_id))?.locked_by_run_id).toBeNull();
  }, 60_000);
});

describe('a run whose worker was cut while its session lock is still live', () => {
  it('is taken over at once by the next claim of the same job, not after the lock expires', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const { queue_key, job, event } = await seed_session_turn_job(db, seeded);
    const claim = new AbortController();
    engine.turns.push(async function* (input) {
      yield assistant_says('Looking up the rain backup plan.');
      claim.abort(new Error('The Compute instance was cut.'));
      if (!input.signal.aborted) {
        await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
      }
    });
    await expect(
      find_event_job_handler(api_session_turn_job_handler)?.run({
        db,
        workspace_id: seeded.workspace_id,
        queue_key,
        event_jobs: [job],
        events: [event],
        heartbeat: async () => undefined,
        record_progress: async () => undefined,
        run_queue_jobs_in_the_background: () => undefined,
        record_started_run_id: async (run_id) => {
          await db.update(event_jobs).set({ run_id }).where(eq(event_jobs.job_id, job.job_id));
        },
        signal: claim.signal,
      }),
    ).rejects.toBeInstanceOf(AgentRunStoppedError);
    const stopped_job = await db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, job.job_id),
    });
    const run_id = stopped_job?.run_id;
    if (!run_id) throw new Error('The first claim recorded no run.');
    const left_lock = await read_session(db, seeded.session_id);
    expect(left_lock?.locked_by_run_id).toBe(run_id);
    expect(left_lock?.lock_expires_time?.getTime()).toBeGreaterThan(Date.now() + 60_000);

    await db
      .update(event_jobs)
      .set({
        job_status: 'running',
        lock_token: randomUUID(),
        locked_by: 'queue_worker:cut',
        locked_until: new Date(Date.now() - 1_000),
      })
      .where(eq(event_jobs.job_id, job.job_id));
    expect(await recover_expired_event_jobs(db)).toMatchObject([
      { job_id: job.job_id, job_status: 'queued', interruption_count: 1 },
    ]);
    engine.turns.push(async function* () {
      yield assistant_says('The rain backup plan is tent B.');
    });

    const started = Date.now();
    await run_queue_jobs(
      db,
      { workspace_id: seeded.workspace_id, queue_key },
      find_event_job_handler,
    );

    const finished_job = await db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, job.job_id),
    });
    expect(finished_job?.job_status).toBe('done');
    expect(finished_job?.run_id).toBe(run_id);
    expect(Date.now() - started).toBeLessThan(10_000);
    const session_runs = await db.query.runs.findMany({
      where: eq(runs.session_id, seeded.session_id),
    });
    expect(session_runs.map((run) => [run.run_id, run.run_status])).toEqual([
      [run_id, 'completed'],
    ]);
    const messages = await list_messages(db, run_id);
    expect(messages.filter((message) => message.message_role === 'user')).toHaveLength(1);
    expect((await read_session(db, seeded.session_id))?.locked_by_run_id).toBeNull();
  }, 60_000);
});

describe('a continued run with a read-only call that never finished', () => {
  it('runs the call again and finishes the same ledger row', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const call: ToolCallPart = {
      type: 'tool_call',
      id: 'call_list_crashed',
      name: 'workspace-list_files',
      arguments: { path: '.' },
    };
    const run = await create_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      agent_id: seeded.agent_id,
      trigger_type: 'user_message',
      actor_id: seeded.user_id,
    });
    await db.update(runs).set({ run_status: 'running' }).where(eq(runs.run_id, run.run_id));
    await create_run_messages(db, [
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        run_id: run.run_id,
        message_role: 'user',
        message_content: { type: 'text', text: 'What is in the workspace?' },
        source_type: 'dashboard',
        actor_id: seeded.user_id,
      },
    ]);
    await record_runtime_event(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      run_id: run.run_id,
      event: {
        event_id: 'evt_turn_1',
        event_sequence: 1,
        run_key: run.run_id,
        event_type: 'message',
        message: { role: 'assistant', content: [call] },
      },
      actor_id: seeded.user_id,
    });
    const crashed_row = await create_tool_call_started(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      run_id: run.run_id,
      agent_id: seeded.agent_id,
      tool_name: call.name,
      tool_input: call.arguments,
      risk_class: 'read',
      approval_mode: 'auto',
      idempotency_key: `${run.run_id}:${call.id}`,
      tool_call_metadata: { policy: { risk_class: 'read' }, runtime_tool_call_id: call.id },
      actor_id: seeded.user_id,
    });
    engine.turns.push(async function* () {
      yield assistant_says('The workspace is empty.');
    });

    const continued = await start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      resume_run_id: run.run_id,
      actor_id: seeded.user_id,
    });

    expect(continued.run_id).toBe(run.run_id);
    expect(continued.run_status).toBe('completed');
    const rows = await db.query.tool_calls.findMany({ where: eq(tool_calls.run_id, run.run_id) });
    expect(rows.map((row) => [row.tool_call_id, row.tool_status])).toEqual([
      [crashed_row.tool_call_id, 'completed'],
    ]);
    expect(rows[0]?.output_data).not.toBeNull();
    const user_messages = (await list_messages(db, run.run_id)).filter(
      (message) => message.message_role === 'user',
    );
    expect(user_messages).toHaveLength(1);
  }, 60_000);
});

describe('a continued run whose stopped turn thought before it asked for a tool', () => {
  it('finishes the same ledger row and replays the turn to the model', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const call: ToolCallPart = {
      type: 'tool_call',
      id: 'call_list_after_thinking',
      name: 'workspace-list_files',
      arguments: { path: '.' },
    };
    const run = await create_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      agent_id: seeded.agent_id,
      trigger_type: 'user_message',
      actor_id: seeded.user_id,
    });
    await db.update(runs).set({ run_status: 'running' }).where(eq(runs.run_id, run.run_id));
    await create_run_messages(db, [
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        run_id: run.run_id,
        message_role: 'user',
        message_content: { type: 'text', text: 'What is in the workspace?' },
        source_type: 'dashboard',
        actor_id: seeded.user_id,
      },
    ]);
    await record_runtime_event(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      run_id: run.run_id,
      event: {
        event_id: 'evt_turn_thinking',
        event_sequence: 1,
        run_key: run.run_id,
        event_type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'I should list the files first.' }, call],
        },
      },
      actor_id: seeded.user_id,
    });
    const crashed_row = await create_tool_call_started(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      run_id: run.run_id,
      agent_id: seeded.agent_id,
      tool_name: call.name,
      tool_input: call.arguments,
      risk_class: 'read',
      approval_mode: 'auto',
      idempotency_key: `${run.run_id}:${call.id}`,
      tool_call_metadata: { policy: { risk_class: 'read' }, runtime_tool_call_id: call.id },
      actor_id: seeded.user_id,
    });
    engine.turns.push(async function* () {
      yield assistant_says('The workspace is empty.');
    });

    const continued = await start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      resume_run_id: run.run_id,
      actor_id: seeded.user_id,
    });

    expect(continued.run_status).toBe('completed');
    const rows = await db.query.tool_calls.findMany({ where: eq(tool_calls.run_id, run.run_id) });
    expect(rows.map((row) => [row.tool_call_id, row.tool_status])).toEqual([
      [crashed_row.tool_call_id, 'completed'],
    ]);
    const model_input = engine.inputs.at(-1);
    expect(
      model_input?.messages.some(
        (message) => message.role === 'assistant' && JSON.stringify(message).includes(call.id),
      ),
    ).toBe(true);
  }, 60_000);
});

async function seed_stopped_run(
  db: Database,
  seeded: Awaited<ReturnType<typeof seed_workspace>>,
  call: ToolCallPart,
) {
  const run = await create_run(db, {
    workspace_id: seeded.workspace_id,
    session_id: seeded.session_id,
    agent_id: seeded.agent_id,
    trigger_type: 'user_message',
    actor_id: seeded.user_id,
  });
  await db.update(runs).set({ run_status: 'running' }).where(eq(runs.run_id, run.run_id));
  await create_run_messages(db, [
    {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      run_id: run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Please do this.' },
      source_type: 'dashboard',
      actor_id: seeded.user_id,
    },
  ]);
  await record_runtime_event(db, {
    workspace_id: seeded.workspace_id,
    session_id: seeded.session_id,
    run_id: run.run_id,
    event: {
      event_id: `evt_turn_${call.id}`,
      event_sequence: 1,
      run_key: run.run_id,
      event_type: 'message',
      message: { role: 'assistant', content: [call] },
    },
    actor_id: seeded.user_id,
  });
  return run;
}

async function seed_finished_row(
  db: Database,
  seeded: Awaited<ReturnType<typeof seed_workspace>>,
  input: {
    run_id: string;
    call: ToolCallPart;
    stored: ReturnType<typeof tool_result_v2_from_runtime_result>;
    finished?: boolean;
  },
) {
  const row = await create_tool_call_started(db, {
    workspace_id: seeded.workspace_id,
    session_id: seeded.session_id,
    run_id: input.run_id,
    agent_id: seeded.agent_id,
    tool_name: input.call.name,
    tool_input: input.call.arguments,
    idempotency_key: `${input.run_id}:${input.call.id}`,
    tool_call_metadata: { runtime_tool_call_id: input.call.id },
    actor_id: seeded.user_id,
  });
  await store_tool_call_output(db, {
    workspace_id: seeded.workspace_id,
    session_id: seeded.session_id,
    run_id: input.run_id,
    tool_call_id: row.tool_call_id,
    output: input.stored,
    output_text: null,
    actor_id: seeded.user_id,
  });
  if (input.finished === false) return row;
  await update_tool_call_finished(db, {
    tool_call_id: row.tool_call_id,
    tool_status: 'completed',
    duration_ms: 12,
    actor_id: seeded.user_id,
  });
  return row;
}

async function read_tool_result_messages(db: Database, workspace_id: string, run_id: string) {
  const rows = await db.query.run_messages.findMany({
    where: and(eq(run_messages.run_id, run_id), eq(run_messages.message_role, 'tool_result')),
  });
  return restore_run_message_tool_results(db, { workspace_id, rows, reading: 'load_full_value' });
}

describe('a continued run whose last call finished before the worker stopped', () => {
  it('writes the email result from the ledger and sends nothing again', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    await allow_email(db, seeded);
    const sent = stub_resend(async () => Response.json({ id: 'email_again' }));
    const email: ToolCallPart = {
      type: 'tool_call',
      id: 'call_email_done',
      name: 'email-send-1',
      arguments: { to: ['founder@runtime.local'], subject: 'Rain backup', message: 'Tent B.' },
    };
    const run = await seed_stopped_run(db, seeded, email);
    const row = await seed_finished_row(db, seeded, {
      run_id: run.run_id,
      call: email,
      stored: tool_result_v2_from_platform_result({
        success: true,
        data: { sent: true, email_id: 'email_before_the_stop' },
      }),
    });
    engine.turns.push(async function* () {
      yield assistant_says('Sent the rain backup plan to the founder.');
    });

    const continued = await start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      resume_run_id: run.run_id,
      actor_id: seeded.user_id,
    });

    expect(continued.run_status).toBe('completed');
    expect(sent).toHaveLength(0);
    const rows = await db.query.tool_calls.findMany({ where: eq(tool_calls.run_id, run.run_id) });
    expect(rows.map((candidate) => [candidate.tool_call_id, candidate.tool_status])).toEqual([
      [row.tool_call_id, 'completed'],
    ]);
    const results = await read_tool_result_messages(db, seeded.workspace_id, run.run_id);
    expect(results.map((message) => message.tool_call_id)).toEqual([row.tool_call_id]);
    expect(JSON.stringify(results[0]?.message_content)).toContain('email_before_the_stop');
    const tool_messages =
      engine.inputs.at(-1)?.messages.filter((message) => message.role === 'tool') ?? [];
    expect(JSON.stringify(tool_messages)).toContain('email_before_the_stop');
    expect(JSON.stringify(tool_messages)).toContain(email.id);
  }, 60_000);

  it('writes a workspace tool result from the ledger without running the tool', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const call: ToolCallPart = {
      type: 'tool_call',
      id: 'call_list_done',
      name: 'workspace-list_files',
      arguments: { path: '.' },
    };
    const run = await seed_stopped_run(db, seeded, call);
    await seed_finished_row(db, seeded, {
      run_id: run.run_id,
      call,
      stored: tool_result_v2_from_runtime_result({
        ok: true,
        content_text: 'saved-listing-before-the-stop.txt',
      }),
    });
    engine.turns.push(async function* () {
      yield assistant_says('Listed.');
    });

    const continued = await start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      resume_run_id: run.run_id,
      actor_id: seeded.user_id,
    });

    expect(continued.run_status).toBe('completed');
    const results = await read_tool_result_messages(db, seeded.workspace_id, run.run_id);
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0]?.message_content)).toContain(
      'saved-listing-before-the-stop.txt',
    );
    const rows = await db.query.tool_calls.findMany({ where: eq(tool_calls.run_id, run.run_id) });
    expect(rows).toHaveLength(1);
  }, 60_000);

  it('finishes a row whose result was stored before its finish, and sends nothing again', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    await allow_email(db, seeded);
    const sent = stub_resend(async () => Response.json({ id: 'email_again' }));
    const email: ToolCallPart = {
      type: 'tool_call',
      id: 'call_email_stored',
      name: 'email-send-1',
      arguments: { to: ['founder@runtime.local'], subject: 'Rain backup', message: 'Tent B.' },
    };
    const run = await seed_stopped_run(db, seeded, email);
    const row = await seed_finished_row(db, seeded, {
      run_id: run.run_id,
      call: email,
      stored: tool_result_v2_from_platform_result({
        success: true,
        data: { sent: true, email_id: 'email_stored_not_finished' },
      }),
      finished: false,
    });
    engine.turns.push(async function* () {
      yield assistant_says('Sent.');
    });

    await start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      resume_run_id: run.run_id,
      actor_id: seeded.user_id,
    });

    expect(sent).toHaveLength(0);
    const finished = await db.query.tool_calls.findFirst({
      where: eq(tool_calls.tool_call_id, row.tool_call_id),
    });
    expect(finished?.tool_status).toBe('completed');
    const tool_usage = await db.query.usage_records.findMany({
      where: and(eq(usage_records.run_id, run.run_id), eq(usage_records.usage_kind, 'tool_call')),
    });
    expect(tool_usage).toHaveLength(1);
    const results = await read_tool_result_messages(db, seeded.workspace_id, run.run_id);
    expect(JSON.stringify(results.map((m) => m.message_content))).toContain(
      'email_stored_not_finished',
    );
  }, 60_000);

  it('still sends a new email exactly once, and a repeat of that call reuses its result', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    await allow_email(db, seeded);
    const sent = stub_resend(async () => Response.json({ id: 'email_1' }));
    const run = await seed_stopped_run(db, seeded, {
      type: 'tool_call',
      id: 'call_email_new',
      name: 'email-send-1',
      arguments: {},
    });
    const send = () =>
      execute_runtime_tool(db, {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        run_id: run.run_id,
        agent_id: seeded.agent_id,
        model_tool_call_id: 'call_email_new',
        node_key: 'email-send-1',
        tool_input: { to: ['founder@runtime.local'], subject: 'Rain', message: 'Tent B.' },
        actor_id: seeded.user_id,
      });

    const first = await send();
    const again = await send();

    expect(first.result.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(again.result).toEqual(first.result);
    expect(again.tool_call.tool_call_id).toBe(first.tool_call.tool_call_id);
    const results = await read_tool_result_messages(db, seeded.workspace_id, run.run_id);
    expect(results).toHaveLength(1);
  }, 60_000);
});

function assistant_says_with_usage(
  text: string,
  tokens: { input: number; output: number },
): RuntimeAgentEngineEvent {
  const cost = { input: tokens.input / 1e6, output: tokens.output / 1e6 };
  return {
    type: 'message',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      metadata: {
        usage: {
          ...tokens,
          cacheRead: 10,
          cacheWrite: 0,
          totalTokens: tokens.input + tokens.output + 10,
          cost: { ...cost, cacheRead: 0, cacheWrite: 0, total: cost.input + cost.output },
        },
      },
    },
  };
}

describe('a run continued after its worker stopped', () => {
  it('keeps the spend of both parts on the run row, equal to the usage ledger', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const claim = new AbortController();
    let run_id = '';
    engine.turns.push(async function* (input) {
      run_id = input.run_key;
      yield assistant_says_with_usage('Starting the report.', { input: 1_000, output: 200 });
      claim.abort(new Error('The claim on this job was lost.'));
      if (!input.signal.aborted) {
        await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
      }
    });
    await expect(
      start_agent_run(
        db,
        {
          workspace_id: seeded.workspace_id,
          session_id: seeded.session_id,
          user_message: 'Write the report.',
          actor_id: seeded.user_id,
        },
        { stop_signal: claim.signal },
      ),
    ).rejects.toBeInstanceOf(AgentRunStoppedError);
    await db
      .update(sessions)
      .set({ lock_expires_time: new Date(Date.now() - 1_000) })
      .where(eq(sessions.session_id, seeded.session_id));
    engine.turns.push(async function* () {
      yield assistant_says_with_usage('Here is the report.', { input: 3_000, output: 500 });
    });

    await start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      resume_run_id: run_id,
      actor_id: seeded.user_id,
    });

    const records = await db.query.usage_records.findMany({
      where: and(eq(usage_records.run_id, run_id), eq(usage_records.usage_kind, 'llm_tokens')),
    });
    expect(records).toHaveLength(2);
    const run = await db.query.runs.findFirst({ where: eq(runs.run_id, run_id) });
    expect(run?.input_tokens).toBe(4_000);
    expect(run?.output_tokens).toBe(700);
    expect(run?.cache_read_tokens).toBe(20);
    expect(run?.cost_microcents).toBe(
      records.reduce((total, record) => total + record.cost_microcents, 0),
    );
    expect(run?.cost_microcents).toBeGreaterThan(0);
  }, 60_000);
});

describe('a person cancelling a run', () => {
  it('still marks the run cancelled and frees the session', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    let announce_run: (run_id: string) => void = () => undefined;
    const run_started = new Promise<string>((resolve) => {
      announce_run = resolve;
    });
    engine.turns.push(async function* (input) {
      announce_run(input.run_key);
      await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
    });

    const running = start_agent_run(db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      user_message: 'Write the long report.',
      actor_id: seeded.user_id,
    });
    const run_id = await run_started;
    await cancel_agent_run(db, {
      workspace_id: seeded.workspace_id,
      run_id,
      actor_id: seeded.user_id,
    });
    await running;

    const run = await db.query.runs.findFirst({ where: eq(runs.run_id, run_id) });
    expect(run?.run_status).toBe('cancelled');
    expect((await read_session(db, seeded.session_id))?.locked_by_run_id).toBeNull();
  }, 60_000);

  it('stops a run at once when the stop came while it was still booting', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const signal_at_model_call: boolean[] = [];
    engine.turns.push(async function* (input) {
      signal_at_model_call.push(input.signal.aborted);
      if (input.signal.aborted) return;
      await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
    });

    const run = await start_agent_run(
      db,
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        user_message: 'Write the long report.',
        actor_id: seeded.user_id,
      },
      {
        on_stream_event: async (event) => {
          if (event.type !== 'run_created') return;
          await request_run_cancellation(db, seeded.workspace_id, event.run.run_id, seeded.user_id);
        },
      },
    );

    expect(signal_at_model_call).toEqual([true]);
    expect(run.run_status).toBe('cancelled');
    expect((await read_session(db, seeded.session_id))?.locked_by_run_id).toBeNull();
  }, 60_000);
});
