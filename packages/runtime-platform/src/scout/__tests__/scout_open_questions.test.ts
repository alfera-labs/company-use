import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  choices_wait_subject,
  create_choices_wait,
  create_tool_policy_wait,
} from '@coworker/core/db/queries/event_waits';
import { create_run, create_run_message, create_session } from '@coworker/core/db/queries/sessions';
import { collect_scout_context } from '@runtime-platform/scout/scout_context';
import { format_open_loops } from '@runtime-platform/scout/scout_packet_sections';
import { expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof create_test_database>>;
type Bootstrap = Awaited<ReturnType<typeof bootstrap_default_workspace>>;

it('tells the scout an unanswered chat question is a question in that chat, not a held approval', async () => {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const asked = await ask_a_question_in_chat(db, bootstrap);
  await hold_a_tool_call(db, bootstrap);

  const context = await collect_scout_context(db, {
    workspace_id: bootstrap.workspace_id,
    now: new Date(),
    embedder: undefined,
  });

  const questions = context.open_loops.filter((loop) => loop.kind === 'question_unanswered');
  const approvals = context.open_loops.filter((loop) => loop.kind === 'approval_waiting');
  expect(questions).toHaveLength(1);
  expect(approvals).toHaveLength(1);
  expect(questions[0]).toMatchObject({
    reference_id: asked.session_id,
    title: 'A question in chat is waiting for the person to pick an answer',
  });
  expect(questions[0]?.detail).toContain(`the chat "Refund policy" (${asked.session_id})`);
  expect(questions[0]?.detail).toContain(
    'Only that chat waits for the answer; no other work is held.',
  );
  const described = format_open_loops(context.open_loops);
  expect(described).toContain(`[question_unanswered] A question in chat is waiting`);
  expect(described).not.toContain(asked.job_id);
});

async function ask_a_question_in_chat(db: Db, bootstrap: Bootstrap) {
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Refund policy',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  await create_run_message(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    message_role: 'assistant',
    message_content: { type: 'text', text: 'The policy is ready. Which term should go in it?' },
    source_type: 'runtime',
    actor_id: bootstrap.user_id,
  });
  const { event_job } = await create_choices_wait(db, {
    workspace_id: bootstrap.workspace_id,
    queue_key: choices_wait_subject({ run_id: run.run_id }),
    actor_id: bootstrap.user_id,
    wait: {
      version: 1,
      kind: 'choices_wait',
      session_id: session.session_id,
      source_run_id: run.run_id,
      asked_by: bootstrap.user_id,
      eligible_user_ids: [bootstrap.user_id],
      tool_call_id: 'tc_choices',
    },
  });
  return { session_id: session.session_id, job_id: event_job.job_id };
}

async function hold_a_tool_call(db: Db, bootstrap: Bootstrap) {
  await create_tool_policy_wait(db, {
    workspace_id: bootstrap.workspace_id,
    queue_key: 'tool_policy:ses_other:call_1',
    actor_id: bootstrap.user_id,
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: 'ses_other',
      source_run_id: 'run_other',
      calls: [{ tool_call_id: 'tc_send', input_sha256: 'sha_1' }],
      requested_by: bootstrap.user_id,
      eligible_user_ids: [bootstrap.user_id],
    },
  });
}
