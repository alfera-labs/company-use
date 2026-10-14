import type { RuntimeToolContext } from '@agent-core/tools/runtime_tool';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { cap_strings_in_tool_payload, create_logger, format_error_message } from '@coworker/shared';
import {
  type ChatScratchOwner,
  save_chat_scratch_file,
} from '@runtime-platform/files/chat_scratch_files';
import { redact_prompt_secrets } from '@runtime-platform/orchestrator/context/prompt_secret_hygiene';
import {
  type RunAudience,
  read_tool_call_audience,
} from '@runtime-platform/orchestrator/run_audience';
import {
  type WorkspaceLayout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';

const log = create_logger('workspace_activity_log');

const workspace_activity_directory = 'system/activity';

/**
 * Inside tmp/, the sandbox's own disk: no other chat mounts it. A copy kept for this chat alone
 * puts it back when the chat moves to a new sandbox.
 */
export const private_activity_folder = 'tmp/activity';

const activity_folder_by_audience: Readonly<
  Record<RunAudience, (layout: WorkspaceLayout) => string | null>
> = {
  workspace: (layout) => layout.activity_folder,
  narrow: (layout) => (layout.activity_folder ? private_activity_folder : null),
};

export type WorkspaceActivityEntry = {
  run_id: string;
  tool_name: string;
  ok: boolean;
  input: unknown;
  result: unknown;
  output_path?: string;
};

/** The activity line for one finished workspace tool call. */
export function workspace_activity_entry(
  call: { run_id: string; tool_name: string; tool_input: unknown },
  result: RuntimeToolResult,
): WorkspaceActivityEntry {
  return {
    run_id: call.run_id,
    tool_name: call.tool_name,
    ok: result.ok,
    input: call.tool_input,
    result: result.ok ? result.content_json : result.error_message,
    ...(typeof result.metadata?.full_output_path === 'string'
      ? { output_path: result.metadata.full_output_path }
      : {}),
  };
}

function workspace_activity_path(
  now: Date,
  run_id: string,
  activity_folder: string = workspace_activity_directory,
) {
  return `${activity_folder}/${now.toISOString().slice(0, 10)}/${safe_run_segment(run_id)}.jsonl`;
}

function safe_run_segment(run_id: string) {
  return run_id.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 64) || 'run';
}

function format_workspace_activity_line(entry: WorkspaceActivityEntry, now: Date) {
  return `${JSON.stringify({
    time: now.toISOString(),
    run_id: entry.run_id,
    tool: entry.tool_name,
    ok: entry.ok,
    input: redact_activity_payload(entry.input),
    result: redact_activity_payload(entry.result),
    ...(entry.output_path ? { output_path: entry.output_path } : {}),
  })}\n`;
}

function redact_activity_payload(value: unknown) {
  const capped = cap_strings_in_tool_payload(value);
  const text = typeof capped === 'string' ? capped : JSON.stringify(capped);
  return redact_prompt_secrets(text ?? '') ?? '';
}

/**
 * Appends one line to this run's activity file. A run narrower than the workspace writes it to
 * sandbox scratch, never to the shared volume, and keeps a copy for its own chat. Never throws:
 * an agent's own history is worth writing, and never worth failing a tool call the user already
 * saw succeed.
 */
export async function append_workspace_activity(
  context: Pick<RuntimeToolContext, 'environment' | 'metadata'> & ChatScratchOwner,
  entry: WorkspaceActivityEntry,
  now = new Date(),
) {
  const environment = context.environment;
  if (!environment?.write || !environment.read) return;
  const layout = workspace_layout_for_version(environment.metadata?.workspace_layout_version);
  const run_audience = read_tool_call_audience(context.metadata, entry.run_id);
  const activity_folder = activity_folder_by_audience[run_audience](layout);
  if (!activity_folder) return;
  const activity_path = workspace_activity_path(now, entry.run_id, activity_folder);
  try {
    const existing = await environment.read(activity_path).catch(() => '');
    const contents = existing + format_workspace_activity_line(entry, now);
    await environment.write(activity_path, contents);
    await save_chat_scratch_file(
      {
        workspace_id: context.workspace_id,
        session_id: context.session_id,
        workspace_path: activity_path,
        data: new TextEncoder().encode(contents),
        content_type: 'application/x-ndjson',
      },
      now,
    );
  } catch (error) {
    log.debug('Could not append to the workspace activity log.', {
      activity_path,
      error: format_error_message(error),
    });
  }
}
