import type { Database } from '@coworker/core';
import { get_catalog_node_identity } from '@coworker/core/db/queries/catalog';
import { hash_tool_input_for_approval } from '@coworker/core/db/queries/event_waits';
import { get_tool_call } from '@coworker/core/db/queries/sessions';
import type {
  ToolPolicyApprovalCallData,
  ToolPolicyApprovalGrantData,
} from '@coworker/core/db/schema/json_column_types';
import { create_logger, format_error_message } from '@coworker/shared';
import { record_chat_stream_event_drafts } from '@runtime-platform/chat_stream/chat_stream_events';
import { read_session_run_audience } from '@runtime-platform/orchestrator/session_run_audience';
import {
  mark_coding_workspace_idle,
  open_or_create_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import {
  close_held_tool_call,
  refused_by_person_message,
  type ToolCallApprovalContext,
} from '@runtime-platform/tools/policies/tool_call_awaiting_approval';
import {
  create_runtime_tool_definitions,
  execute_runtime_tool,
} from '@runtime-platform/tools/tool_execution_service';
import { find_tool_by_node_key } from '@runtime-platform/tools/tool_registry';

const log = create_logger('policy_decision_replay');

const catalog_transport_node_key = 'runtime-execute_tool-1';

class RunToolUnavailable extends Error {}

type ToolCallRow = NonNullable<Awaited<ReturnType<typeof get_tool_call>>>;

export type DecidedCallOutcome = {
  tool_call_id: string;
  tool_name: string;
  outcome: 'ran' | 'refused' | 'could_not_run' | 'missing';
  reason?: string;
};

export async function run_decided_tool_calls(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    job_id: string;
    decision: 'approved' | 'denied';
    decision_event_id: string;
    reason?: string | undefined;
    calls: readonly ToolPolicyApprovalCallData[];
    actor_id: string;
  },
): Promise<DecidedCallOutcome[]> {
  const outcomes: DecidedCallOutcome[] = [];
  for (const call of input.calls) outcomes.push(await run_one_decided_call(db, input, call));
  return outcomes;
}

async function run_one_decided_call(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  call: ToolPolicyApprovalCallData,
): Promise<DecidedCallOutcome> {
  const tool_call = await get_tool_call(db, input.workspace_id, call.tool_call_id);
  if (!tool_call) {
    return { tool_call_id: call.tool_call_id, tool_name: 'unknown', outcome: 'missing' };
  }
  if (tool_call.tool_status !== 'awaiting_approval') {
    return { tool_call_id: call.tool_call_id, tool_name: tool_call.tool_name, outcome: 'ran' };
  }

  if (input.decision === 'denied') {
    await close_refused_call(db, input, tool_call);
    return { tool_call_id: call.tool_call_id, tool_name: tool_call.tool_name, outcome: 'refused' };
  }

  if (hash_tool_input_for_approval(tool_call.input_data) !== call.input_sha256) {
    await close_unrunnable_call(db, input, tool_call, 'input_changed_since_approval');
    return {
      tool_call_id: call.tool_call_id,
      tool_name: tool_call.tool_name,
      outcome: 'could_not_run',
    };
  }

  return run_approved_call(db, input, tool_call, call);
}

async function run_approved_call(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
  call: ToolPolicyApprovalCallData,
): Promise<DecidedCallOutcome> {
  const grant: ToolPolicyApprovalGrantData = {
    version: 1,
    job_id: input.job_id,
    node_key: tool_call.tool_name,
    input_sha256: call.input_sha256,
    decision_event_id: input.decision_event_id,
    tool_call_id: tool_call.tool_call_id,
  };
  try {
    await run_the_tool_the_row_names(db, input, tool_call, grant);
    return { tool_call_id: tool_call.tool_call_id, tool_name: tool_call.tool_name, outcome: 'ran' };
  } catch (error) {
    const reason = format_error_message(error);
    log.error('running an approved tool call failed', {
      workspace_id: input.workspace_id,
      tool_call_id: tool_call.tool_call_id,
      error: reason,
    });
    await close_unrunnable_call(db, input, tool_call, unrunnable_code(error));
    return {
      tool_call_id: tool_call.tool_call_id,
      tool_name: tool_call.tool_name,
      outcome: 'could_not_run',
      reason,
    };
  }
}

function write_chat_events_for(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
) {
  return async (drafts: Parameters<typeof record_chat_stream_event_drafts>[1]['drafts']) => {
    await record_chat_stream_event_drafts(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: tool_call.run_id,
      drafts,
      actor_id: input.actor_id,
    });
  };
}

async function run_the_tool_the_row_names(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
  grant: ToolPolicyApprovalGrantData,
) {
  const target = await read_call_to_run(db, input.workspace_id, tool_call);
  const metadata = { run_audience: await read_session_run_audience(db, input) };
  if (!target) return run_call_with_the_runs_own_tools(db, input, tool_call, metadata);

  const model_tool_call_id = read_model_tool_call_id(tool_call);
  await execute_runtime_tool(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: tool_call.run_id,
    ...(tool_call.agent_id ? { agent_id: tool_call.agent_id } : {}),
    node_key: target.node_key,
    tool_input: target.tool_input,
    resume_tool_call_id: tool_call.tool_call_id,
    emit_chat_stream_event_drafts: write_chat_events_for(db, input, tool_call),
    ...(model_tool_call_id ? { model_tool_call_id } : {}),
    source_context: { source_type: 'runtime', source_metadata: { policy_approval: grant } },
    actor_id: input.actor_id,
    tool_context_metadata: metadata,
  });
}

async function run_call_with_the_runs_own_tools(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
  metadata: Readonly<Record<string, unknown>>,
) {
  const model_tool_call_id = read_model_tool_call_id(tool_call);
  const workspace = await open_the_runs_workspace(db, input, tool_call);
  try {
    const tool = create_runtime_tool_definitions(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: tool_call.run_id,
      ...(tool_call.agent_id ? { agent_id: tool_call.agent_id } : {}),
      runtime_environment_id: workspace.runtime_environment_id,
      environment: workspace.environment,
      emit_chat_stream_event_drafts: write_chat_events_for(db, input, tool_call),
      actor_id: input.actor_id,
    }).find((definition) => definition.tool_name === tool_call.tool_name);
    if (!tool?.execute) {
      throw new RunToolUnavailable(`That run no longer offers ${tool_call.tool_name}.`);
    }

    await tool.execute(tool_call.input_data, {
      run_key: tool_call.run_id,
      session_key: input.session_id,
      ...(model_tool_call_id ? { tool_call_id: model_tool_call_id } : {}),
      environment: workspace.environment,
      metadata,
    });
  } finally {
    await mark_coding_workspace_idle(db, {
      workspace_id: input.workspace_id,
      runtime_environment_id: workspace.runtime_environment_id,
      close_token: workspace.close_token,
      actor_id: input.actor_id,
    });
  }
}

async function open_the_runs_workspace(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
) {
  try {
    return await open_or_create_coding_workspace(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      agent_id: tool_call.agent_id,
      run_id: tool_call.run_id,
      actor_id: input.actor_id,
    });
  } catch (error) {
    const reason = format_error_message(error);
    throw new RunToolUnavailable(`That run's workspace could not be opened again: ${reason}`);
  }
}

async function read_call_to_run(db: Database, workspace_id: string, tool_call: ToolCallRow) {
  if (find_tool_by_node_key(tool_call.tool_name)) {
    return { node_key: tool_call.tool_name, tool_input: tool_call.input_data };
  }
  const catalog_node = await get_catalog_node_identity(db, {
    workspace_id,
    node_key: tool_call.tool_name,
  });
  if (!catalog_node) return null;

  const connection_id = read_connection_id(tool_call);
  return {
    node_key: catalog_transport_node_key,
    tool_input: {
      node_key: tool_call.tool_name,
      input: tool_call.input_data,
      ...(connection_id ? { connection_id } : {}),
    },
  };
}

function read_connection_id(tool_call: ToolCallRow) {
  const connection_id = tool_call.tool_call_metadata?.connection_id;
  return typeof connection_id === 'string' ? connection_id : undefined;
}

function read_model_tool_call_id(tool_call: ToolCallRow) {
  const model_tool_call_id = tool_call.tool_call_metadata?.runtime_tool_call_id;
  return typeof model_tool_call_id === 'string' ? model_tool_call_id : undefined;
}

function close_refused_call(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
) {
  return close_held_tool_call(db, settling_context(db, input, tool_call), {
    tool_call_id: tool_call.tool_call_id,
    decision_event_id: input.decision_event_id,
    tool_status: 'denied',
    error_code: 'refused_by_person',
    message: refused_by_person_message(input.reason),
    event_label: 'tool_call.refused',
  });
}

function settling_context(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
): ToolCallApprovalContext {
  return {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: tool_call.run_id,
    ...(tool_call.agent_id ? { agent_id: tool_call.agent_id } : {}),
    actor_id: input.actor_id,
    emit_chat_stream_event_drafts: write_chat_events_for(db, input, tool_call),
  };
}

const unrunnable_messages = {
  input_changed_since_approval: 'This did not run: it no longer matches what was approved.',
  run_tool_unavailable:
    'This was approved but could not be replayed: it belongs to the run that asked, and that run could not be opened again.',
  approved_call_could_not_run: 'This was approved but could not run. Nothing was sent.',
} satisfies Record<string, string>;

type UnrunnableCode = keyof typeof unrunnable_messages;

function unrunnable_code(error: unknown): UnrunnableCode {
  return error instanceof RunToolUnavailable
    ? 'run_tool_unavailable'
    : 'approved_call_could_not_run';
}

function close_unrunnable_call(
  db: Database,
  input: Parameters<typeof run_decided_tool_calls>[1],
  tool_call: ToolCallRow,
  error_code: UnrunnableCode,
) {
  return close_held_tool_call(db, settling_context(db, input, tool_call), {
    tool_call_id: tool_call.tool_call_id,
    decision_event_id: input.decision_event_id,
    tool_status: 'failed',
    error_code,
    message: unrunnable_messages[error_code],
    event_label: 'tool_call.error',
  });
}
