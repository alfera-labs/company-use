import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { event_jobs, run_messages, runs, tool_calls } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { math_calculate_tool } from '@runtime-platform/tools/definitions/math_calculate';
import { record_the_answer } from '@runtime-platform/tools/policies/answer_from_the_person';
import { repeat_after_restart_question } from '@runtime-platform/tools/policies/repeat_approval';
import { execute_runtime_tool } from '@runtime-platform/tools/tool_execution_service';
import { find_tool_repeat_safety } from '@runtime-platform/tools/tool_repeat_safety';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tool_input = { expression: '3 + 3' };
const model_tool_call_id = 'call_before_restart';

afterEach(() => vi.restoreAllMocks());

async function seed_call_in_the_crash_window(db: Database) {
  await seed_runtime_tool_catalog(db);
  const workspace = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: workspace.workspace_id,
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  });
  const run = await create_run(db, {
    workspace_id: workspace.workspace_id,
    session_id: session.session_id,
    agent_id: workspace.agent_id,
    trigger_type: 'user_message',
    actor_id: workspace.user_id,
  });
  const row = await create_tool_call_started(db, {
    workspace_id: workspace.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: workspace.agent_id,
    tool_name: math_calculate_tool.node_key,
    tool_input,
    idempotency_key: `${run.run_id}:${model_tool_call_id}`,
    tool_call_metadata: {
      approval_policy: math_calculate_tool.approval_policy,
      category: math_calculate_tool.category,
      runtime_tool_call_id: model_tool_call_id,
    },
    actor_id: workspace.user_id,
  });
  return { workspace, session, run, row };
}

function run_the_call_again(
  db: Database,
  seeded: Awaited<ReturnType<typeof seed_call_in_the_crash_window>>,
) {
  return execute_runtime_tool(db, {
    workspace_id: seeded.workspace.workspace_id,
    session_id: seeded.session.session_id,
    run_id: seeded.run.run_id,
    agent_id: seeded.workspace.agent_id,
    model_tool_call_id,
    node_key: math_calculate_tool.node_key,
    tool_input,
    actor_id: seeded.workspace.user_id,
  });
}

async function wait_for_the_question(db: Database, tool_call_id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await db.query.tool_calls.findFirst({
      where: eq(tool_calls.tool_call_id, tool_call_id),
    });
    const job_id = row?.tool_call_metadata.approval_request_id;
    if (row?.tool_status === 'awaiting_approval' && typeof job_id === 'string') {
      const job = await db.query.event_jobs.findFirst({ where: eq(event_jobs.job_id, job_id) });
      if (job) return { row, job };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The call was never held for a person.');
}

async function answer(
  db: Database,
  seeded: Awaited<ReturnType<typeof seed_call_in_the_crash_window>>,
  decision: 'approved' | 'denied',
) {
  const { row, job } = await wait_for_the_question(db, seeded.row.tool_call_id);
  expect(row.tool_call_metadata.approval_question).toBe(repeat_after_restart_question);
  expect(job.job_status).toBe('waiting');
  expect(job.metadata.policy_approval).toMatchObject({
    question: repeat_after_restart_question,
    calls: [{ tool_call_id: seeded.row.tool_call_id }],
  });
  const run = await db.query.runs.findFirst({ where: eq(runs.run_id, seeded.run.run_id) });
  expect(run?.waiting_on_job_id).toBe(job.job_id);
  await record_the_answer(db, {
    workspace_id: seeded.workspace.workspace_id,
    job_id: job.job_id,
    queue_key: job.awaits_queue_key ?? job.queue_key,
    decided_by: seeded.workspace.user_id,
    decision,
  });
}

async function read_row(db: Database, tool_call_id: string) {
  return db.query.tool_calls.findFirst({ where: eq(tool_calls.tool_call_id, tool_call_id) });
}

describe('an unfinished call that asks a person before it repeats', () => {
  it('is classed ask_a_person: the tool does not say it only reads', async () => {
    const db = await create_test_database();
    const seeded = await seed_call_in_the_crash_window(db);
    expect(find_tool_repeat_safety({ ...seeded.row, started_time: new Date() })).toBe(
      'ask_a_person',
    );
  });

  it('runs once, on the same row, when the person says yes', async () => {
    const db = await create_test_database();
    const seeded = await seed_call_in_the_crash_window(db);
    const execute = vi.spyOn(math_calculate_tool, 'execute');

    const running = run_the_call_again(db, seeded);
    await answer(db, seeded, 'approved');
    const execution = await running;

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execution.result.success).toBe(true);
    expect(execution.tool_call.tool_call_id).toBe(seeded.row.tool_call_id);
    const rows = await db.query.tool_calls.findMany({
      where: eq(tool_calls.run_id, seeded.run.run_id),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_status).toBe('completed');
    const results = await db.query.run_messages.findMany({
      where: eq(run_messages.tool_call_id, seeded.row.tool_call_id),
    });
    expect(results).toHaveLength(1);
  }, 30_000);

  it('never runs, and the row is closed as skipped, when the person says no', async () => {
    const db = await create_test_database();
    const seeded = await seed_call_in_the_crash_window(db);
    const execute = vi.spyOn(math_calculate_tool, 'execute');

    const running = run_the_call_again(db, seeded);
    await answer(db, seeded, 'denied');
    const execution = await running;

    expect(execute).not.toHaveBeenCalled();
    expect(execution.result).toMatchObject({
      success: false,
      error: { code: 'repeat_declined' },
    });
    const row = await read_row(db, seeded.row.tool_call_id);
    expect(row?.tool_status).toBe('denied');
    expect(row?.error_message).toContain('did not run again');
  }, 30_000);
});
