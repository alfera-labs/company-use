import type { Database } from '@coworker/core';
import {
  read_approval_calls,
  tool_policy_approval_wait_schema,
} from '@coworker/core/access/tool_policy_approval_schema';
import {
  list_session_tool_policy_waits,
  withdraw_run_tool_policy_waits,
} from '@coworker/core/db/queries/event_waits';
import {
  cancel_run,
  create_run_event,
  get_tool_call,
  release_session_execution_lock,
} from '@coworker/core/db/queries/sessions';
import { record_chat_stream_event_drafts } from '@runtime-platform/chat_stream/chat_stream_events';
import {
  awaiting_approval_status,
  close_held_tool_call,
} from '@runtime-platform/tools/policies/tool_call_awaiting_approval';

const interrupted_message = 'Interrupted before a decision. It did not run.';

export async function interrupt_parked_session_runs(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
): Promise<{ interrupted_run_ids: string[] }> {
  const waits = await list_session_tool_policy_waits(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    status: 'waiting',
  });
  const interrupted_run_ids: string[] = [];
  for (const wait of waits) {
    const parsed = tool_policy_approval_wait_schema.safeParse(wait.metadata.policy_approval);
    if (!parsed.success) continue;
    const run_id = parsed.data.source_run_id;

    await close_held_calls(db, input, run_id, read_approval_calls(parsed.data));
    await withdraw_run_tool_policy_waits(db, {
      workspace_id: input.workspace_id,
      run_id,
      actor_id: input.actor_id,
    });
    await cancel_run(db, input.workspace_id, run_id, input.actor_id);
    await release_session_execution_lock(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id,
      actor_id: input.actor_id,
      session_status: 'cancelled',
    });
    await record_chat_stream_event_drafts(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id,
      drafts: [
        {
          event_type: 'run_completed',
          run_status: 'cancelled',
          source: { source_type: 'runtime_event' },
        },
      ],
      actor_id: input.actor_id,
    });
    interrupted_run_ids.push(run_id);
  }
  return { interrupted_run_ids };
}

async function close_held_calls(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
  run_id: string,
  calls: readonly { tool_call_id: string }[],
) {
  const marker = await create_run_event(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id,
    event_type: 'progress',
    event_label: 'tool_policy.interrupted',
    event_data: { run_id },
    actor_id: input.actor_id,
  });
  for (const call of calls) {
    const tool_call = await get_tool_call(db, input.workspace_id, call.tool_call_id);
    if (!tool_call || tool_call.tool_status !== awaiting_approval_status) continue;
    await close_held_tool_call(
      db,
      {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        run_id,
        ...(tool_call.agent_id ? { agent_id: tool_call.agent_id } : {}),
        actor_id: input.actor_id,
        emit_chat_stream_event_drafts: async (drafts) => {
          await record_chat_stream_event_drafts(db, {
            workspace_id: input.workspace_id,
            session_id: input.session_id,
            run_id,
            drafts,
            actor_id: input.actor_id,
          });
        },
      },
      {
        tool_call_id: tool_call.tool_call_id,
        decision_event_id: marker.run_event_id,
        tool_status: 'failed',
        error_code: 'interrupted_before_decision',
        message: interrupted_message,
        event_label: 'tool_call.error',
      },
    );
  }
}
