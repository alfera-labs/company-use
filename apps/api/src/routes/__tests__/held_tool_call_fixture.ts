import type { Database } from '@coworker/core/db/connection';
import {
  create_tool_policy_wait,
  new_approval_request_id,
} from '@coworker/core/db/queries/event_waits';
import {
  mark_run_completion_waiting,
  mark_run_waiting,
  record_run_wait,
} from '@coworker/core/db/queries/run_suspension';
import {
  create_run,
  list_session_runs,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { record_chat_stream_event_drafts } from '@runtime-platform/chat_stream/chat_stream_events';
import {
  record_step_awaiting_approval,
  record_tool_call_awaiting_approval,
} from '@runtime-platform/tools/policies/tool_call_awaiting_approval';

export async function hold_a_tool_call_for_approval(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
) {
  const { workspace_id, session_id, actor_id } = input;
  const [previous] = await list_session_runs(db, workspace_id, session_id);
  if (!previous) throw new Error('the session has no run');
  const run = await create_run(db, {
    workspace_id,
    session_id,
    agent_id: previous.agent_id,
    trigger_type: 'user_message',
    actor_id,
  });
  await update_run_status(db, { run_id: run.run_id, run_status: 'running', actor_id });
  const job_id = new_approval_request_id();
  const held = await record_tool_call_awaiting_approval(
    db,
    { workspace_id, session_id, run_id: run.run_id, actor_id },
    {
      target: {
        tool_call_id: 'call-1',
        called_tool_name: 'send_email',
        node_key: 'gmail-send_email-1',
        tool_input: { to: 'someone@example.com' },
        connection_id: null,
        approval_policy: null,
        metadata: null,
      },
      approval_request_id: job_id,
      eligible_user_ids: [actor_id],
    },
  );
  await record_chat_stream_event_drafts(db, {
    workspace_id,
    session_id,
    run_id: run.run_id,
    drafts: held.chat_event_drafts,
    actor_id,
  });
  const tool_call = held.tool_call;
  const queue_key = `run:${run.run_id}:approval`;
  await create_tool_policy_wait(db, {
    workspace_id,
    queue_key,
    job_id,
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id,
      source_run_id: run.run_id,
      calls: [{ tool_call_id: tool_call.tool_call_id, input_sha256: 'a'.repeat(64) }],
      requested_by: null,
      eligible_user_ids: [actor_id],
    },
    actor_id,
  });
  await record_step_awaiting_approval(
    db,
    { workspace_id, session_id, run_id: run.run_id, actor_id },
    { approval_request_id: job_id, tool_call_ids: [tool_call.tool_call_id] },
  );
  await record_run_wait(db, { workspace_id, run_id: run.run_id, job_id, actor_id });
  await record_chat_stream_event_drafts(db, {
    workspace_id,
    session_id,
    run_id: run.run_id,
    drafts: [
      {
        event_type: 'run_completed',
        run_status: 'completed',
        source: { source_type: 'runtime_event' },
      },
    ],
    actor_id,
  });
  await mark_run_waiting(db, { workspace_id, run_id: run.run_id, actor_id });
  await mark_run_completion_waiting(db, { workspace_id, run_id: run.run_id, actor_id });
  return { job_id, tool_call_id: tool_call.tool_call_id, run_id: run.run_id, queue_key };
}
