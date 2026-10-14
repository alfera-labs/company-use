import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { choices_wait_subject } from '@coworker/core/db/queries/event_waits';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { present_choices_node_key } from '@coworker/shared';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { present_choices_tool } from '@runtime-platform/tools/definitions/present_choices';
import { record_the_choices_answer } from '@runtime-platform/tools/policies/answer_the_choices';
import { approval_wait_window_ms } from '@runtime-platform/tools/policies/wait_for_the_person';
import {
  execute_runtime_tool,
  platform_tool_timeout_ms,
} from '@runtime-platform/tools/tool_execution_service';
import { find_tool_by_node_key } from '@runtime-platform/tools/tool_registry';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { describe, expect, it } from 'vitest';

async function the_wait_on_disk(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: { workspace_id: string; queue_key: string },
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waits = await db.query.event_jobs.findMany({
      where: (jobs, { and, eq }) =>
        and(eq(jobs.workspace_id, input.workspace_id), eq(jobs.awaits_queue_key, input.queue_key)),
    });
    if (waits.length > 0) return waits;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}

const one_question = {
  questions: [
    {
      kind: 'choice' as const,
      question: 'How often should this run?',
      options: [{ label: 'Every Monday' }, { label: 'Every morning' }],
      recommended_option: 'Every Monday',
    },
  ],
};

async function a_run_that_can_ask() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
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
  return {
    db,
    bootstrap,
    queue_key: choices_wait_subject({ run_id: run.run_id }),
    context: {
      db,
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    },
  };
}

describe('chat-present_choices-1', () => {
  it('returns what was answered, as the result of the call that asked', async () => {
    const { db, bootstrap, context, queue_key } = await a_run_that_can_ask();

    const asking = present_choices_tool.execute(one_question, context);

    const [wait] = await the_wait_on_disk(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key,
    });
    expect(wait?.job_status).toBe('waiting');

    await record_the_choices_answer(db, {
      workspace_id: bootstrap.workspace_id,
      job_id: wait?.job_id as string,
      queue_key,
      answered_by: bootstrap.user_id,
      answer_text: 'Every Monday',
    });

    const result = (await asking) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data.answered).toBe(true);
    expect(result.data.answer).toBe('Every Monday');
    expect(result.data.questions).toHaveLength(1);
  }, 20_000);

  it('comes back unanswered rather than failing when nobody is there', async () => {
    const { context } = await a_run_that_can_ask();

    const result = (await present_choices_tool.execute(one_question, {
      ...context,
      signal: AbortSignal.abort(),
    })) as { success: boolean; data: Record<string, unknown> };

    expect(result.success).toBe(true);
    expect(result.data.answered).toBe(false);
  }, 20_000);

  it('shows one panel when the same run asks twice', async () => {
    const { db, bootstrap, context, queue_key } = await a_run_that_can_ask();

    const first = present_choices_tool.execute(one_question, context);
    const second = present_choices_tool.execute(one_question, context);

    const waits = await the_wait_on_disk(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key,
    });
    expect(waits).toHaveLength(1);

    await record_the_choices_answer(db, {
      workspace_id: bootstrap.workspace_id,
      job_id: waits[0]?.job_id as string,
      queue_key,
      answered_by: bootstrap.user_id,
      answer_text: 'Every Monday',
    });

    for (const result of await Promise.all([first, second])) {
      expect((result as { data: Record<string, unknown> }).data.answer).toBe('Every Monday');
    }
  }, 20_000);

  it('is given a longer leash than the wait it is racing', () => {
    expect(platform_tool_timeout_ms(present_choices_tool, one_question)).toBeGreaterThan(
      approval_wait_window_ms(),
    );
  });

  it('leaves every other tool on the flat minute', () => {
    const ordinary = find_tool_by_node_key('math-calculate-1');
    expect(ordinary).toBeDefined();
    expect(platform_tool_timeout_ms(ordinary as never, { expression: '2 + 2' })).toBe(60_000);
  });

  it('carries the answer back through the wrapper the model actually calls', async () => {
    const { db, bootstrap, context, queue_key } = await a_run_that_can_ask();
    await seed_runtime_tool_catalog(db);

    const asking = execute_runtime_tool(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      node_key: present_choices_node_key,
      tool_input: one_question,
      actor_id: bootstrap.user_id,
    });

    const [wait] = await the_wait_on_disk(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key,
    });
    await record_the_choices_answer(db, {
      workspace_id: bootstrap.workspace_id,
      job_id: wait?.job_id as string,
      queue_key,
      answered_by: bootstrap.user_id,
      answer_text: 'Every Monday',
    });

    const execution = await asking;
    expect(execution.result.success).toBe(true);
    expect((execution.result as { data: Record<string, unknown> }).data.answer).toBe(
      'Every Monday',
    );
    expect(execution.tool_call.tool_status).toBe('completed');
    const parked = await db.query.event_jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.job_id, wait?.job_id as string),
    });
    expect(parked?.metadata.choices_wait?.tool_call_id).toBe(execution.tool_call.tool_call_id);
    expect(parked?.metadata.answer_taken_by_the_run_that_asked).toBe(true);
  }, 20_000);

  it('stops the wait when the wrapper gives up on it', async () => {
    const { db, bootstrap, context } = await a_run_that_can_ask();
    await seed_runtime_tool_catalog(db);
    const asked_with: (RuntimeToolExecutionContext | undefined)[] = [];
    const declared_window = present_choices_tool.policy_timeout_ms;
    if (!declared_window) throw new Error('present_choices must declare its own window.');
    const body = present_choices_tool.execute;
    present_choices_tool.policy_timeout_ms = () => 200;
    present_choices_tool.execute = (input, tool_context) => {
      asked_with.push(tool_context);
      return body(input, tool_context);
    };

    try {
      const execution = await execute_runtime_tool(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: context.session_id,
        run_id: context.run_id,
        node_key: present_choices_node_key,
        tool_input: one_question,
        actor_id: bootstrap.user_id,
      });

      expect(execution.result.success).toBe(false);
      expect((execution.result as { error: { code: string } }).error.code).toBe('timed_out');
      expect(asked_with[0]?.signal?.aborted).toBe(true);
    } finally {
      present_choices_tool.policy_timeout_ms = declared_window;
      present_choices_tool.execute = body;
    }
  }, 20_000);

  it('still returns the questions when there is nobody to park for', async () => {
    const result = (await present_choices_tool.execute(one_question)) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(result.success).toBe(true);
    expect(result.data.answered).toBe(false);
    expect(result.data.questions).toHaveLength(1);
  });
});
