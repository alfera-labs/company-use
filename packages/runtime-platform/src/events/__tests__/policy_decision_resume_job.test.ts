import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_tool_policy_wait,
  get_tool_policy_wait,
  hash_tool_input_for_approval,
  policy_decision_event_type,
  tool_policy_wait_subject,
} from '@coworker/core/db/queries/event_waits';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { mark_run_waiting, record_run_wait } from '@coworker/core/db/queries/run_suspension';
import {
  create_run,
  create_session,
  create_tool_call_started,
  get_run,
  get_session,
  get_tool_call,
  update_run_status,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import { runs } from '@coworker/core/db/schema';
import { wait_expiry_actor_id } from '@runtime-platform/events/policy_decision_step_closing';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orchestrator = vi.hoisted(() => ({ start_run: vi.fn() }));

vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', async (import_original) => ({
  ...(await import_original<object>()),
  start_agent_run: orchestrator.start_run,
}));

const { run_policy_decision_resume_job } = await import(
  '@runtime-platform/events/policy_decision_resume_job'
);

beforeEach(() => {
  orchestrator.start_run.mockReset();
  orchestrator.start_run.mockImplementation(
    async (
      db: Parameters<typeof create_run>[0],
      input: {
        workspace_id: string;
        session_id: string;
        actor_id: string;
        resumed_from_job_id?: string;
      },
      options?: {
        on_stream_event?: (event: {
          type: 'run_created';
          run: { run_id: string };
        }) => Promise<void>;
      },
    ) => {
      const session = await get_session(db, input.workspace_id, input.session_id);
      if (!session) throw new Error('The continuation session is missing.');
      const run = await create_run(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        agent_id: session.agent_id,
        trigger_type: 'api',
        resumed_from_job_id: input.resumed_from_job_id ?? null,
        actor_id: input.actor_id,
      });
      await options?.on_stream_event?.({ type: 'run_created', run });
      return { run_id: run.run_id };
    },
  );
});

describe('catching a chat up on an answered step', () => {
  it('delivers nothing when the run that asked already used the answer', async () => {
    const asked = await ask_about_a_step();
    await the_asking_run_ran_the_call(asked);
    await the_asking_run_finished_carrying_its_wait(asked);

    const result = await deliver_the_answer(asked);

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { answered_in_the_run_that_asked: true, session_id: asked.session.session_id },
    });
    expect(orchestrator.start_run).not.toHaveBeenCalled();
    expect(await read_run_status(asked)).toBe('completed');
  });

  it('replays the step and picks the chat back up when the run that asked died holding it', async () => {
    const asked = await ask_about_a_step();
    await set_run_status(asked, 'failed');

    const result = await deliver_the_answer(asked);

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: true, decision: 'approved', calls_run: 1 },
    });
    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
    const tool_call = await read_the_tool_call(asked);
    expect(tool_call?.tool_status).toBe('completed');
    expect(JSON.stringify(tool_call?.output_data)).toContain('4');
    expect(await read_run_status(asked)).toBe('failed');
  });

  it.each([
    'queued',
    'starting',
    'running',
  ] as const)('comes back shortly while the run that asked is still %s', async (run_status) => {
    const asked = await ask_about_a_step();
    await set_run_status(asked, run_status);

    const result = await deliver_the_answer(asked);

    expect(result).toMatchObject({
      job_status: 'done',
      retry_counts_as_attempt: false,
      result_data: { waiting_for_the_run_that_asked: true },
    });
    expect(result.retry_at).toBeInstanceOf(Date);
    expect(orchestrator.start_run).not.toHaveBeenCalled();
    expect((await read_the_tool_call(asked))?.tool_status).toBe('awaiting_approval');
  });

  it('refuses an expired step and starts no run in the old chat', async () => {
    const asked = await ask_about_a_step();
    await set_run_status(asked, 'failed');

    const result = await deliver_the_answer(asked, {
      decision: 'denied',
      actor_id: wait_expiry_actor_id,
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { nobody_answered: true, calls_refused: 1 },
    });
    expect(orchestrator.start_run).not.toHaveBeenCalled();
    expect((await read_the_tool_call(asked))?.tool_status).not.toBe('awaiting_approval');
  });

  it('starts no second run when the same answer arrives twice', async () => {
    const asked = await ask_about_a_step();
    await set_run_status(asked, 'failed');
    const first = await deliver_the_answer(asked);

    const second = await deliver_the_answer(asked);

    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      job_status: 'done',
      run_id: first.run_id,
      result_data: { resumed: true, decision: 'recovered' },
    });
  });
});

type AskedStep = Awaited<ReturnType<typeof ask_about_a_step>>;

async function ask_about_a_step() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  const tool_input = { expression: '2 + 2' };
  const tool_call = await create_tool_call_started(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: bootstrap.agent_id,
    tool_name: 'math-calculate-1',
    tool_input,
    tool_status: 'awaiting_approval',
    actor_id: bootstrap.user_id,
  });
  const input_sha256 = hash_tool_input_for_approval(tool_input);
  const queue_key = tool_policy_wait_subject({
    run_id: run.run_id,
    approval_call_hashes: [input_sha256],
  });
  const wait = await create_tool_policy_wait(db, {
    workspace_id: bootstrap.workspace_id,
    queue_key,
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: session.session_id,
      source_run_id: run.run_id,
      calls: [{ tool_call_id: tool_call.tool_call_id, input_sha256 }],
      requested_by: bootstrap.user_id,
      eligible_user_ids: [bootstrap.user_id],
    },
    actor_id: bootstrap.user_id,
  });
  await update_run_status(db, {
    run_id: run.run_id,
    run_status: 'running',
    actor_id: bootstrap.user_id,
  });
  await record_run_wait(db, {
    workspace_id: bootstrap.workspace_id,
    run_id: run.run_id,
    job_id: wait.event_job.job_id,
    actor_id: bootstrap.user_id,
  });

  return {
    db,
    bootstrap,
    session,
    run,
    tool_call,
    queue_key,
    job_id: wait.event_job.job_id,
  };
}

function the_asking_run_ran_the_call(asked: AskedStep) {
  return update_tool_call_finished(asked.db, {
    tool_call_id: asked.tool_call.tool_call_id,
    tool_status: 'completed',
    output: { result: 4 },
    duration_ms: 1,
    actor_id: asked.bootstrap.user_id,
  });
}

function the_asking_run_finished_carrying_its_wait(asked: AskedStep) {
  return mark_run_waiting(asked.db, {
    workspace_id: asked.bootstrap.workspace_id,
    run_id: asked.run.run_id,
    actor_id: asked.bootstrap.user_id,
  });
}

function set_run_status(
  asked: AskedStep,
  run_status: 'queued' | 'starting' | 'running' | 'failed',
) {
  return asked.db.update(runs).set({ run_status }).where(eq(runs.run_id, asked.run.run_id));
}

async function deliver_the_answer(
  asked: AskedStep,
  answer: { decision: 'approved' | 'denied'; actor_id?: string } = { decision: 'approved' },
) {
  const decision = await enqueue_event_jobs(asked.db, {
    workspace_id: asked.bootstrap.workspace_id,
    source: 'policy',
    source_event_id: `${asked.job_id}:decision`,
    event_type: policy_decision_event_type,
    queue_key: asked.queue_key,
    actor_key: answer.actor_id ?? asked.bootstrap.user_id,
    event_body: { job_id: asked.job_id, decision: answer.decision },
  });
  const job = await get_tool_policy_wait(asked.db, {
    workspace_id: asked.bootstrap.workspace_id,
    job_id: asked.job_id,
  });
  if (!job) throw new Error('The approval request is missing.');

  return run_policy_decision_resume_job({
    db: asked.db,
    workspace_id: asked.bootstrap.workspace_id,
    event_jobs: [job],
    events: [decision.event],
  });
}

function read_the_tool_call(asked: AskedStep) {
  return get_tool_call(asked.db, asked.bootstrap.workspace_id, asked.tool_call.tool_call_id);
}

async function read_run_status(asked: AskedStep) {
  return (await get_run(asked.db, asked.bootstrap.workspace_id, asked.run.run_id))?.run_status;
}
