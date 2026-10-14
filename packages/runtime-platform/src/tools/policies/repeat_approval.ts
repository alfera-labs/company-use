import type { Database } from '@coworker/core';
import { read_policy_scope_ids } from '@coworker/core/access/policy_scope_context';
import {
  create_tool_policy_wait,
  hash_tool_input_for_approval,
  new_approval_request_id,
  tool_policy_wait_subject,
} from '@coworker/core/db/queries/event_waits';
import { record_run_wait } from '@coworker/core/db/queries/run_suspension';
import { hold_tool_call_for_approval } from '@coworker/core/db/queries/sessions';
import type {
  ToolPolicyApprovalGrantData,
  ToolPolicyApprovalWaitDataV2,
} from '@coworker/core/db/schema/json_column_types';
import { create_logger } from '@coworker/shared';
import { send_approval_cards } from '@runtime-platform/tools/policies/approval_delivery';
import {
  record_awaiting_approval_result,
  type ToolCallApprovalContext,
} from '@runtime-platform/tools/policies/tool_call_awaiting_approval';
import {
  type PersonAnswered,
  wait_for_the_person,
} from '@runtime-platform/tools/policies/wait_for_the_person';

const log = create_logger('repeat_approval');

export const repeat_after_restart_question =
  'This action may already have run once before a restart. Run it again?';

export type RepeatApprovalContext = ToolCallApprovalContext & {
  acting_actor_id?: string;
  signal?: AbortSignal;
};

type HeldCall = {
  tool_call_id: string;
  tool_name: string;
  model_tool_call_id?: string;
  input_data: unknown;
};

export type RepeatAnswer =
  | { answer: 'approved'; grant: ToolPolicyApprovalGrantData }
  | { answer: 'denied'; reason: string }
  | { answer: 'unanswered' };

export async function ask_whether_to_run_again(
  db: Database,
  context: RepeatApprovalContext,
  call: HeldCall,
): Promise<RepeatAnswer> {
  const deciders = await read_deciders(db, context);
  if (deciders.length === 0) {
    return {
      answer: 'denied',
      reason:
        'This action may already have run once before a restart, and nobody in this run can say whether to run it again. It did not run again.',
    };
  }

  const { input_sha256, queue_key, wait } = build_repeat_wait(context, call, deciders);
  const written = await create_tool_policy_wait(db, {
    workspace_id: context.workspace_id,
    queue_key,
    wait,
    job_id: new_approval_request_id(),
    actor_id: wait.requested_by ?? context.actor_id,
  });
  const job_id = written.event_job.job_id;
  await hold_the_call(db, context, call, { job_id, deciders });
  if (written.created) send_cards_in_the_background(db, context, written.event_job);

  const waited = await wait_for_the_person(db, {
    workspace_id: context.workspace_id,
    job_id,
    queue_key,
    actor_id: context.actor_id,
    signal: context.signal,
  });
  return read_repeat_answer(waited, { job_id, call, input_sha256 });
}

function build_repeat_wait(context: RepeatApprovalContext, call: HeldCall, deciders: string[]) {
  const input_sha256 = hash_tool_input_for_approval(call.input_data);
  const queue_key = tool_policy_wait_subject({
    run_id: context.run_id,
    approval_call_hashes: [input_sha256],
  });
  const wait: ToolPolicyApprovalWaitDataV2 = {
    version: 2,
    kind: 'tool_policy_approval',
    session_id: context.session_id,
    source_run_id: context.run_id,
    calls: [{ tool_call_id: call.tool_call_id, input_sha256, needs_a_person: true }],
    requested_by: context.actor_id.startsWith('user_') ? context.actor_id : null,
    eligible_user_ids: deciders,
    question: repeat_after_restart_question,
  };
  return { input_sha256, queue_key, wait };
}

function read_repeat_answer(
  waited: PersonAnswered,
  input: { job_id: string; call: HeldCall; input_sha256: string },
): RepeatAnswer {
  if (!waited.answered) return { answer: 'unanswered' };
  if (waited.answer.decision === 'denied') {
    return {
      answer: 'denied',
      reason: 'A person chose not to run this again after a restart. It did not run again.',
    };
  }
  return {
    answer: 'approved',
    grant: {
      version: 1,
      job_id: input.job_id,
      node_key: input.call.tool_name,
      input_sha256: input.input_sha256,
      decision_event_id: waited.answer.decision_event_id,
      tool_call_id: input.call.tool_call_id,
    },
  };
}

async function hold_the_call(
  db: Database,
  context: RepeatApprovalContext,
  call: HeldCall,
  input: { job_id: string; deciders: string[] },
) {
  const held = await hold_tool_call_for_approval(db, {
    workspace_id: context.workspace_id,
    tool_call_id: call.tool_call_id,
    tool_call_metadata_patch: {
      approval_request_id: input.job_id,
      approval_eligible_user_ids: input.deciders,
      approval_needs_a_person: true,
      approval_question: repeat_after_restart_question,
    },
    actor_id: context.actor_id,
  });
  if (!held)
    throw new Error(`The tool call ${call.tool_call_id} finished while it was being held.`);

  const [chat_event_draft] = await Promise.all([
    record_awaiting_approval_result(db, context, {
      tool_call: held,
      tool_name: call.tool_name,
      model_tool_call_id: call.model_tool_call_id || undefined,
    }),
    record_run_wait(db, {
      workspace_id: context.workspace_id,
      run_id: context.run_id,
      job_id: input.job_id,
      actor_id: context.actor_id,
    }),
  ]);
  await context.emit_chat_stream_event_drafts?.([chat_event_draft]);
}

async function read_deciders(db: Database, context: RepeatApprovalContext) {
  const scopes = await read_policy_scope_ids(db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    ...(context.agent_id ? { agent_id: context.agent_id } : {}),
    actor_id: context.actor_id,
    ...(context.acting_actor_id ? { acting_actor_id: context.acting_actor_id } : {}),
  });
  return [...scopes.user];
}

function send_cards_in_the_background(
  db: Database,
  context: RepeatApprovalContext,
  wait: Parameters<typeof send_approval_cards>[1]['wait'],
) {
  void send_approval_cards(db, { workspace_id: context.workspace_id, wait }).catch(
    (error: unknown) => {
      log.warn('sending the approval cards failed', {
        workspace_id: context.workspace_id,
        job_id: wait.job_id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
}
