import type { Database } from '@coworker/core';
import { list_run_files } from '@coworker/core/db/queries/files';
import {
  get_run,
  list_run_messages,
  list_run_tool_calls,
} from '@coworker/core/db/queries/sessions';
import {
  restore_run_message_tool_results,
  restore_tool_call_outputs,
} from '@coworker/runtime-platform';

export type ObservedRunTrace = Awaited<ReturnType<typeof build_observed_run_trace>>;

export async function build_observed_run_trace(
  db: Database,
  input: { workspace_id: string; run_id: string },
) {
  const workspace_id = input.workspace_id;
  const reading = 'load_full_value' as const;
  const [run, messages, tool_calls, files] = await Promise.all([
    get_run(db, workspace_id, input.run_id),
    list_run_messages(db, workspace_id, input.run_id).then((rows) =>
      restore_run_message_tool_results(db, { workspace_id, rows, reading }),
    ),
    list_run_tool_calls(db, workspace_id, input.run_id).then((rows) =>
      restore_tool_call_outputs(db, { workspace_id, rows, reading }),
    ),
    list_run_files(db, workspace_id, input.run_id),
  ]);
  if (!run) throw new Error(`Observed eval run not found: ${input.run_id}`);
  const end_to_end_duration_ms = calculate_end_to_end_duration_ms(run.completed_time, messages);

  return {
    run: trace_run(run, end_to_end_duration_ms),
    messages: messages.map((message) => ({
      message_role: message.message_role,
      message_kind: message.message_kind,
      content_text: message.content_text,
      is_user_visible: message.is_user_visible,
      source_type: message.source_type,
      source_metadata: message.source_metadata,
      created_time: message.created_time,
    })),
    tool_calls: tool_calls.map((tool_call) => ({
      tool_name: tool_call.tool_name,
      tool_status: tool_call.tool_status,
      risk_class: tool_call.risk_class,
      approval_mode: tool_call.approval_mode,
      input_data: tool_call.input_data,
      output_text: tool_call.output_text,
      output_data: tool_call.output_data,
      error_code: tool_call.error_code,
      error_message: tool_call.error_message,
      duration_ms: tool_call.duration_ms,
      created_time: tool_call.created_time,
    })),
    files: files.map((artifact) => ({
      file_purpose: artifact.file_purpose,
      file_status: artifact.file_status,
      workspace_path: artifact.workspace_path,
      file_name: artifact.file_name,
      mime_type: artifact.mime_type,
      content_preview: artifact.content_preview,
      file_metadata: artifact.file_metadata,
    })),
  };
}

type ObservedRun = NonNullable<Awaited<ReturnType<typeof get_run>>>;

function trace_run(run: ObservedRun, end_to_end_duration_ms: number | null) {
  return {
    run_id: run.run_id,
    workspace_id: run.workspace_id,
    session_id: run.session_id,
    run_status: run.run_status,
    model_provider: run.model_provider,
    model_name: run.model_name,
    error_code: run.error_code,
    error_message: run.error_message,
    duration_ms: run.duration_ms ?? run.total_run_ms,
    ...(end_to_end_duration_ms === null ? {} : { end_to_end_duration_ms }),
    input_tokens: run.input_tokens,
    output_tokens: run.output_tokens,
    cache_read_tokens: run.cache_read_tokens,
    cost_microcents: run.cost_microcents_estimate || run.cost_microcents,
    run_metadata: run.run_metadata,
    created_time: run.created_time,
  };
}

function calculate_end_to_end_duration_ms(
  completed_time: Date | null,
  messages: Awaited<ReturnType<typeof list_run_messages>>,
) {
  if (!completed_time) return null;
  const source_message = messages.find(is_triggering_slack_message);
  if (!source_message) return null;
  const event_time = read_slack_event_time(source_message.source_metadata);
  const started_time = event_time ?? source_message.created_time;
  const duration_ms = completed_time.getTime() - started_time.getTime();
  return duration_ms >= 0 ? Math.max(1, duration_ms) : null;
}

function is_triggering_slack_message(
  message: Awaited<ReturnType<typeof list_run_messages>>[number],
) {
  if (message.message_role !== 'user' || message.source_type !== 'slack') return false;
  return message.source_metadata.slack?.history_backfill !== true;
}

function read_slack_event_time(
  source_metadata: Awaited<ReturnType<typeof list_run_messages>>[number]['source_metadata'],
) {
  const event_ts = source_metadata.slack?.event_ts;
  if (!event_ts) return null;
  const milliseconds = Number.parseFloat(event_ts) * 1000;
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}
