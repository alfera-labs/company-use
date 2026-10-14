import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { Database } from '@coworker/core';
import { tool_policy_awaiting_approval_event_label } from '@coworker/core/access/tool_policy_approval_schema';
import { get_catalog_node_identity } from '@coworker/core/db/queries/catalog';
import {
  create_run_event,
  create_tool_call_started,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import {
  type ChatStreamEventDraft,
  create_tool_call_completed_chat_event_draft,
  create_tool_call_started_chat_event_draft,
  type PersistedToolCallForChatStream,
} from '@runtime-platform/chat_stream/chat_stream_events';
import { build_approval_tool_call_metadata } from '@runtime-platform/tools/policies/approval_tool_call_metadata';
import type { ToolPolicyCallTarget } from '@runtime-platform/tools/policies/tool_policy_call';
import {
  create_persisted_tool_result_message,
  create_tool_call_lifecycle_event,
} from '@runtime-platform/tools/tool_execution_service';

export const awaiting_approval_status = 'awaiting_approval';

export type ToolCallApprovalContext = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string;
  actor_id: string;
  emit_chat_stream_event_drafts?: (drafts: ChatStreamEventDraft[]) => void | Promise<void>;
};

export async function record_tool_call_awaiting_approval(
  db: Database,
  context: ToolCallApprovalContext,
  input: {
    target: ToolPolicyCallTarget;
    approval_request_id: string;
    eligible_user_ids: readonly string[];
    needs_a_person?: boolean;
  },
) {
  const catalog_node = await get_catalog_node_identity(db, {
    workspace_id: context.workspace_id,
    node_key: input.target.node_key,
  });
  const tool_call = await create_tool_call_started(db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    run_id: context.run_id,
    ...(context.agent_id ? { agent_id: context.agent_id } : {}),
    node_id: catalog_node?.node_id ?? null,
    node_version: catalog_node?.node_version ?? null,
    tool_name: input.target.node_key,
    tool_input: input.target.tool_input as Record<string, unknown>,
    tool_status: awaiting_approval_status,
    idempotency_key: `${context.run_id}:${input.target.tool_call_id}`,
    tool_call_metadata: build_approval_tool_call_metadata(input),
    actor_id: context.actor_id,
  });
  const chat_event_draft = await record_awaiting_approval_result(db, context, {
    tool_call,
    tool_name: input.target.node_key,
    model_tool_call_id: input.target.tool_call_id,
  });
  return { tool_call, chat_event_drafts: [chat_event_draft] };
}

/** Writes the waiting result and the awaiting-approval event for a held call; returns its chat draft. */
export async function record_awaiting_approval_result(
  db: Database,
  context: ToolCallApprovalContext,
  input: {
    tool_call: PersistedToolCallForChatStream;
    tool_name: string;
    model_tool_call_id?: string | undefined;
  },
): Promise<ChatStreamEventDraft> {
  const [, event] = await Promise.all([
    create_persisted_tool_result_message(db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      tool_call_id: input.tool_call.tool_call_id,
      ...(input.model_tool_call_id === undefined
        ? {}
        : { model_tool_call_id: input.model_tool_call_id }),
      tool_name: input.tool_name,
      result: waiting_for_approval_result(),
      result_is_stored_on_tool_call: false,
      actor_id: context.actor_id,
    }),
    create_tool_call_lifecycle_event(db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      tool_call_id: input.tool_call.tool_call_id,
      tool_name: input.tool_name,
      event_label: 'tool_call.awaiting_approval',
      event_data: { tool_status: awaiting_approval_status },
      actor_id: context.actor_id,
    }),
  ]);
  return create_tool_call_started_chat_event_draft({
    tool_call: input.tool_call,
    source_run_event_id: event.run_event_id,
    source_event_sequence: event.event_sequence,
  });
}

export async function record_step_awaiting_approval(
  db: Database,
  context: ToolCallApprovalContext,
  input: { approval_request_id: string; tool_call_ids: string[] },
) {
  return create_run_event(db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    run_id: context.run_id,
    event_type: 'progress',
    event_label: tool_policy_awaiting_approval_event_label,
    event_data: {
      approval_request_id: input.approval_request_id,
      tool_call_ids: input.tool_call_ids,
    },
    actor_id: context.actor_id,
  });
}

export function refuse_tool_call(
  db: Database,
  context: ToolCallApprovalContext,
  input: { tool_call_id: string; decision_event_id: string; reason?: string | null },
) {
  return close_held_tool_call(db, context, {
    tool_call_id: input.tool_call_id,
    decision_event_id: input.decision_event_id,
    tool_status: 'denied',
    error_code: 'refused_by_person',
    message: refused_by_person_message(input.reason),
    event_label: 'tool_call.refused',
  });
}

export async function close_held_tool_call(
  db: Database,
  context: ToolCallApprovalContext,
  input: {
    tool_call_id: string;
    decision_event_id: string;
    tool_status: 'denied' | 'failed';
    error_code: string;
    message: string;
    event_label: string;
  },
) {
  const [finished, event] = await Promise.all([
    update_tool_call_finished(db, {
      tool_call_id: input.tool_call_id,
      tool_status: input.tool_status,
      output: { success: false, error: { code: input.error_code, message: input.message } },
      output_text: input.message,
      error_code: input.error_code,
      error_message: input.message,
      tool_call_metadata_patch: { decision_event_id: input.decision_event_id },
      duration_ms: 0,
      actor_id: context.actor_id,
    }),
    create_tool_call_lifecycle_event(db, {
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      tool_call_id: input.tool_call_id,
      tool_name: 'approval',
      event_label: input.event_label,
      event_data: { tool_status: input.tool_status },
      actor_id: context.actor_id,
    }),
  ]);

  const model_tool_call_id = finished.tool_call_metadata?.runtime_tool_call_id;
  await create_persisted_tool_result_message(db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    run_id: context.run_id,
    tool_call_id: finished.tool_call_id,
    ...(typeof model_tool_call_id === 'string' ? { model_tool_call_id } : {}),
    tool_name: finished.tool_name,
    result: did_not_run_result(input.message),
    result_is_stored_on_tool_call: false,
    actor_id: context.actor_id,
  });

  await context.emit_chat_stream_event_drafts?.([
    create_tool_call_completed_chat_event_draft({
      tool_call: finished,
      source_run_event_id: event.run_event_id,
      source_event_sequence: event.event_sequence,
    }),
  ]);
  return finished;
}

export function refused_by_person_message(reason?: string | null) {
  const said_no = 'A person said no to this. It did not run.';
  const said_why = reason?.trim();
  return said_why ? `${said_no} They said: ${said_why}` : said_no;
}

function did_not_run_result(message: string): RuntimeToolResult {
  return { ok: true, content_text: message, content_json: { did_not_run: true } };
}

export function waiting_for_approval_result(): RuntimeToolResult {
  return {
    ok: true,
    content_text: 'Waiting for a person to approve this step. Nothing in it has run.',
    content_json: { awaiting_approval: true },
  };
}
