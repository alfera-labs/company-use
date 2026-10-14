import { createHash } from 'node:crypto';
import path from 'node:path';
import { create_built_in_tools } from '@agent-core/coding';
import { read_file_with_pi } from '@agent-core/coding/read_file_with_pi';
import type { SessionEnvBackgroundCommandStatus } from '@agent-core/environment';
import { read_image_dimensions, sniff_image_mime_type } from '@agent-core/images/image_header';
import type {
  RuntimeToolDefinition as AgentRuntimeToolDefinition,
  RuntimeJsonSchema,
  RuntimeToolContext,
  RuntimeToolExecutionMode,
} from '@agent-core/tools/runtime_tool';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import { get_catalog_node_identity } from '@coworker/core/db/queries/catalog';
import { create_file } from '@coworker/core/db/queries/files';
import {
  create_run_message,
  create_tool_call_started,
  create_usage_record,
  find_tool_call_by_idempotency_key,
  get_tool_call,
  replace_tool_result_message,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import type { ToolPolicyApprovalGrantData } from '@coworker/core/db/schema/json_column_types';
import {
  cap_model_visible_tool_text,
  create_logger,
  estimate_model_visible_message_tokens,
  format_error_message,
  model_visible_tool_text_limit_chars,
  order_keys_like_jsonb,
  type RuntimeToolResult as PlatformRuntimeToolResult,
  strip_unstorable_characters,
} from '@coworker/shared';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import {
  type ChatStreamEventDraft,
  create_tool_call_completed_chat_event_draft,
  create_tool_call_started_chat_event_draft,
  type PersistedToolCallForChatStream,
} from '@runtime-platform/chat_stream/chat_stream_events';
import { storage_for_workspace_file } from '@runtime-platform/files/chat_scratch_files';
import { mime_type_for_file_name } from '@runtime-platform/files/file_mime_types';
import { e2b_workspace_root } from '@runtime-platform/orchestrator/e2b_command';
import { create_stored_run_event } from '@runtime-platform/orchestrator/stored_run_event_payloads';
import {
  type AfterWorkspaceWriteHook,
  run_after_workspace_write_hooks,
} from '@runtime-platform/tools/after_workspace_write_hooks';
import { create_browser_tool_definitions } from '@runtime-platform/tools/browser_harness';
import { record_files_a_command_wrote } from '@runtime-platform/tools/command_written_files';
import { project_model_visible_tool_payload } from '@runtime-platform/tools/model_visible_tool_result';
import { room_of_parent_call } from '@runtime-platform/tools/nested_tool_call_room';
import { find_platform_tool_policy_connection_id } from '@runtime-platform/tools/policies/platform_tool_policy_connection';
import type { RepeatApprovalContext } from '@runtime-platform/tools/policies/repeat_approval';
import {
  evaluate_tool_policy_gate,
  type ToolPolicyGateResult,
} from '@runtime-platform/tools/policies/tool_policy_gate';
import {
  produced_file_metadata,
  workspace_written_in,
} from '@runtime-platform/tools/produced_workspace_files';
import { defer_run_write } from '@runtime-platform/tools/run_background_writes';
import { PolicyTimeoutError, run_with_timeout } from '@runtime-platform/tools/run_with_timeout';
import {
  stopped_result_when_run_was_stopped,
  stopped_tool_error_code,
} from '@runtime-platform/tools/stopped_tool_result';
import { store_tool_call_output } from '@runtime-platform/tools/stored_tool_result';
import {
  platform_result_to_model_tool_result,
  platform_tool_result_to_runtime_tool_result,
  type ToolResultV2,
  tool_result_v2_from_platform_result,
  tool_result_v2_from_runtime_result,
} from '@runtime-platform/tools/stored_tool_result_shape';
import { tool_output_path } from '@runtime-platform/tools/tool_output_path';
import { find_tool_by_node_key, get_all_tools } from '@runtime-platform/tools/tool_registry';
import {
  runtime_tool_result_text,
  tool_result_message_content,
  tool_result_message_pointer,
  tool_result_text_preview,
} from '@runtime-platform/tools/tool_result_message_content';
import { tools_the_sandbox_serves } from '@runtime-platform/tools/tools_the_sandbox_serves';
import type {
  RuntimeToolDefinition as PlatformRuntimeToolDefinition,
  RuntimeToolExecutionContext as PlatformRuntimeToolExecutionContext,
  RuntimeToolSourceContext,
  RuntimeToolSourceType,
  RuntimeToolSpeaker,
} from '@runtime-platform/tools/types';
import {
  decide_how_to_repeat,
  type RepeatDecision,
  type SavedToolResult,
  still_waiting_for_a_person_result,
  tool_call_has_finished,
} from '@runtime-platform/tools/unfinished_tool_call';
import {
  append_workspace_activity,
  workspace_activity_entry,
} from '@runtime-platform/tools/workspace_activity_log';
import {
  execute_workspace_http_request,
  workspace_http_request_input_schema,
} from '@runtime-platform/tools/workspace_http_request';
import { persist_workspace_tool_side_effects } from '@runtime-platform/tools/workspace_preview_persistence';
import {
  execute_workspace_preview,
  find_static_preview_target,
  type StaticPreviewInput,
  start_static_preview,
  workspace_preview_input_schema,
} from '@runtime-platform/tools/workspace_preview_tool';
import {
  boolean_schema,
  number_schema,
  object_schema,
  string_schema,
} from '@runtime-platform/tools/workspace_tool_json_schemas';
import {
  absolute_workspace_path,
  canonical_shell_working_directory,
  canonical_workspace_file_path,
  canonical_workspace_glob_pattern,
  require_workspace_environment,
  reserved_path_refusal,
  workspace_layout_in,
} from '@runtime-platform/tools/workspace_tool_paths';
import {
  command_result_text,
  err,
  ok_image,
  ok_json,
  ok_text,
  with_result_metadata,
} from '@runtime-platform/tools/workspace_tool_results';
import { write_path_of } from '@runtime-platform/tools/workspace_tool_write_path';
import { z } from 'zod';

export { canonical_shell_working_directory } from '@runtime-platform/tools/workspace_tool_paths';

export type RuntimeToolPolicy = {
  timeout_ms: number;
  output_limit_bytes: number;
  risk_class: 'read' | 'write' | 'send' | 'exec';
  approval_mode: 'auto' | 'review' | 'block';
  sandbox_required: boolean;
};

type WorkspaceToolDefinition<InputSchema extends z.ZodType = z.ZodType> = {
  tool_name: string;
  description: string;
  input_schema: RuntimeJsonSchema;
  validate_input?: InputSchema;
  policy: RuntimeToolPolicy;
  approval_display_fields?: string[];
  policy_timeout_ms?(input: z.infer<InputSchema>): number;
  execute(input: z.infer<InputSchema>, context: RuntimeToolContext): Promise<RuntimeToolResult>;
};

export type ChatStreamEventDraftSink = (drafts: ChatStreamEventDraft[]) => void | Promise<void>;

const default_output_limit_bytes = 16_000;
const exec_policy_timeout_ms = 120_000;
const default_platform_tool_timeout_ms = 60_000;
const log = create_logger('tool_execution_service');

type ExecuteRuntimeToolInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string;
  model_tool_call_id?: string;
  node_key: string;
  tool_input: unknown;
  environment?: RuntimeToolContext['environment'];
  attachment_sources?: ReadonlyMap<string, RuntimeAttachmentSource>;
  source_context?: RuntimeToolSourceContext;
  speaker?: RuntimeToolSpeaker;
  emit_chat_stream_event_drafts?: ChatStreamEventDraftSink;
  tool_result_is_user_visible?: boolean;
  // False for a call the model did not make (a script in the sandbox): the row stays for the
  // audit trail, but a tool_result with no tool_use before it would be rejected by the provider.
  tool_result_is_model_visible?: boolean;
  signal?: AbortSignal;
  actor_id: string;
  participants?: Participants;
  room_private_to?: string | null | undefined;
  resume_tool_call_id?: string;
  tool_context_metadata?: Readonly<Record<string, unknown>>;
};

type PlatformTool = NonNullable<ReturnType<typeof find_tool_by_node_key>>;
type ToolCall = Awaited<ReturnType<typeof create_tool_call_started>>;
type SuccessfulPlatformToolResult = Extract<PlatformRuntimeToolResult, { success: true }>;

function tool_call_idempotency_key(input: {
  run_id: string;
  model_tool_call_id?: string | undefined;
}): string | null {
  return input.model_tool_call_id ? `${input.run_id}:${input.model_tool_call_id}` : null;
}

export async function execute_runtime_tool(db: Database, input: ExecuteRuntimeToolInput) {
  const tool = find_tool_by_node_key(input.node_key);
  if (!tool) {
    throw new Error(`Unknown runtime tool: ${input.node_key}`);
  }

  const parsed_input = tool.validate_input.parse(input.tool_input);
  const started_at = Date.now();
  const catalog_node = await get_catalog_node_identity(db, {
    workspace_id: input.workspace_id,
    node_key: tool.node_key,
  });
  if (!catalog_node) {
    throw new Error(`Runtime tool is missing from the catalog: ${tool.node_key}`);
  }
  const existing_call = await find_existing_tool_call(db, input);
  const repeat: RepeatDecision = existing_call
    ? await decide_how_to_repeat(db, repeat_context(input), existing_call, input.model_tool_call_id)
    : { action: 'run' };
  if (existing_call && repeat.action === 'wait') {
    return { tool, tool_call: existing_call, result: still_waiting_for_a_person_result() };
  }
  if (existing_call && repeat.action === 'reuse_saved_result') {
    return reuse_saved_platform_result(db, input, { tool, tool_call: existing_call, ...repeat });
  }
  const grant = repeat.action === 'run' ? repeat.grant : undefined;
  const run_input = grant
    ? { ...input, source_context: with_approval_grant(input.source_context, grant) ?? {} }
    : input;
  const tool_call =
    existing_call ??
    (await start_tool_call(db, input, {
      tool,
      catalog_node,
      parsed_input,
    }));
  const pending_started_event = record_tool_call_started(db, input, tool_call, tool.node_key);

  let result: PlatformRuntimeToolResult;
  try {
    result =
      repeat.action === 'answer'
        ? repeat.result
        : await run_platform_tool(db, run_input, tool, parsed_input, tool_call.tool_call_id);
  } catch (error) {
    result = platform_tool_failure(error);
  }

  await pending_started_event;

  const final_result = result.success
    ? await spill_oversized_catalog_tool_result(db, input, tool_call, result)
    : result;
  const duration_ms = Date.now() - started_at;
  const result_is_stored = await store_result_on_tool_call(db, input, {
    tool_call_id: tool_call.tool_call_id,
    output: tool_result_v2_from_platform_result(final_result),
    output_text: stringify_tool_result(final_result),
  });
  const finished_call = await defer_run_write(input.run_id, 'tool call outcome', () =>
    save_platform_tool_outcome(db, input, {
      tool,
      tool_call,
      result: final_result,
      duration_ms,
      result_is_stored,
    }),
  );
  await save_platform_tool_result_message(db, input, {
    tool_call,
    tool_name: tool.node_key,
    result: final_result,
    result_is_stored,
  }).catch((error: unknown) =>
    log_tool_outcome_persistence_failure(input, tool_call, final_result, error),
  );
  return {
    tool,
    tool_call: finished_call ? with_tool_call_output(finished_call, final_result) : tool_call,
    result: final_result,
  };
}

async function reuse_saved_platform_result(
  db: Database,
  input: ExecuteRuntimeToolInput,
  output: { tool: PlatformTool; tool_call: ToolCall; saved: SavedToolResult },
) {
  const { tool, tool_call, saved } = output;
  const result = saved.output as PlatformRuntimeToolResult;
  const finished_call = tool_call_has_finished(tool_call)
    ? tool_call
    : await save_platform_tool_outcome(db, input, {
        tool,
        tool_call,
        result,
        duration_ms: unmeasured_duration_ms,
        result_is_stored: saved.result_is_stored,
      });
  await save_platform_tool_result_message(db, input, {
    tool_call,
    tool_name: tool.node_key,
    result,
    result_is_stored: saved.result_is_stored,
  }).catch((error: unknown) =>
    log_tool_outcome_persistence_failure(input, tool_call, result, error),
  );
  return { tool, tool_call: with_tool_call_output(finished_call, result), result };
}

const unmeasured_duration_ms = 0;

async function store_result_on_tool_call(
  db: Database,
  input: { workspace_id: string; session_id: string; run_id: string; actor_id: string },
  output: {
    tool_call_id: string;
    output: ToolResultV2;
    output_text: string;
    output_file_id?: string | undefined;
  },
) {
  try {
    await store_tool_call_output(db, { ...input, ...output });
    return true;
  } catch (error) {
    log.error('Storing the result on its tool call failed; the message keeps its own copy.', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      tool_call_id: output.tool_call_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function with_tool_call_output<T extends { output_data: unknown }>(
  tool_call: T,
  output: unknown,
): T {
  return { ...tool_call, output_data: order_keys_like_jsonb(strip_unstorable_characters(output)) };
}

function save_platform_tool_outcome(
  db: Database,
  input: ExecuteRuntimeToolInput,
  output: {
    tool: PlatformTool;
    tool_call: ToolCall;
    result: PlatformRuntimeToolResult;
    duration_ms: number;
    result_is_stored: boolean;
  },
) {
  const { result } = output;
  const saving = result.success
    ? save_platform_tool_result(db, input, { ...output, result })
    : save_platform_tool_failure(db, input, { ...output, result });
  return saving.catch((error: unknown) => {
    log_tool_outcome_persistence_failure(input, output.tool_call, result, error);
    return finish_tool_call_after_persistence_failure(db, input, output);
  });
}

function with_approval_grant(
  source_context: RuntimeToolSourceContext | undefined,
  grant: ToolPolicyApprovalGrantData | undefined,
): RuntimeToolSourceContext | undefined {
  if (!grant) return source_context;
  return {
    ...source_context,
    source_metadata: { ...source_context?.source_metadata, policy_approval: grant },
  };
}

async function find_existing_tool_call(db: Database, input: ExecuteRuntimeToolInput) {
  if (input.resume_tool_call_id) {
    const named = await get_tool_call(db, input.workspace_id, input.resume_tool_call_id);
    if (!named) throw new Error(`That tool call is missing: ${input.resume_tool_call_id}`);
    return named;
  }

  const idempotency_key = tool_call_idempotency_key(input);
  if (!idempotency_key) return null;
  return find_tool_call_by_idempotency_key(db, {
    workspace_id: input.workspace_id,
    idempotency_key,
  });
}

function repeat_context(input: {
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string | undefined;
  actor_id: string;
  speaker?: RuntimeToolSpeaker | undefined;
  emit_chat_stream_event_drafts?: ChatStreamEventDraftSink | undefined;
  signal?: AbortSignal | undefined;
}): RepeatApprovalContext {
  return {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    actor_id: input.actor_id,
    ...(input.speaker?.source_actor_id ? { acting_actor_id: input.speaker.source_actor_id } : {}),
    ...(input.emit_chat_stream_event_drafts
      ? { emit_chat_stream_event_drafts: input.emit_chat_stream_event_drafts }
      : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

async function start_tool_call(
  db: Database,
  input: ExecuteRuntimeToolInput,
  output: {
    tool: PlatformTool;
    catalog_node: NonNullable<Awaited<ReturnType<typeof get_catalog_node_identity>>>;
    parsed_input: unknown;
  },
) {
  return create_tool_call_started(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    node_id: output.catalog_node.node_id,
    node_version: output.catalog_node.node_version,
    tool_name: output.tool.node_key,
    tool_input: output.parsed_input as Record<string, unknown>,
    risk_class: runtime_tool_risk_class(output.tool),
    approval_mode: runtime_tool_approval_mode(output.tool),
    idempotency_key: tool_call_idempotency_key(input),
    tool_call_metadata: {
      approval_policy: output.tool.approval_policy,
      category: output.tool.category,
      app_name: output.tool.app_name,
      node_provenance: output.catalog_node.node_config.sourced_from ?? null,
      runtime_tool_call_id: input.model_tool_call_id ?? null,
    },
    actor_id: input.actor_id,
  });
}

async function finish_tool_call_after_persistence_failure(
  db: Database,
  input: ExecuteRuntimeToolInput,
  output: {
    tool_call: ToolCall;
    result: PlatformRuntimeToolResult;
    duration_ms: number;
    result_is_stored: boolean;
  },
) {
  const { tool_call, result, duration_ms } = output;
  try {
    return await update_tool_call_finished(db, {
      tool_call_id: tool_call.tool_call_id,
      tool_status: runtime_tool_result_status(result),
      ...unstored_output_fields(output.result_is_stored, result, stringify_tool_result(result)),
      error_code: result.success ? null : result.error.code,
      error_message: result.success ? null : result.error.message,
      ...tool_call_reference_fields(result.metadata),
      duration_ms,
      actor_id: input.actor_id,
    });
  } catch (error) {
    log.error('marking the tool call terminal after partial persistence failed', {
      tool_call_id: tool_call.tool_call_id,
      error: format_error_message(error),
    });
    return tool_call;
  }
}

function log_tool_outcome_persistence_failure(
  input: ExecuteRuntimeToolInput,
  tool_call: ToolCall,
  result: PlatformRuntimeToolResult,
  error: unknown,
) {
  log.error('persisting the tool outcome failed after tool execution', {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    tool_call_id: tool_call.tool_call_id,
    node_key: input.node_key,
    tool_success: result.success,
    error: format_error_message(error),
  });
}

async function run_platform_tool(
  db: Database,
  input: ExecuteRuntimeToolInput,
  tool: PlatformTool,
  tool_input: unknown,
  tool_call_id: string,
): Promise<PlatformRuntimeToolResult> {
  const policy_gate = await evaluate_platform_tool_policy(db, input, tool, tool_input);
  if (policy_gate.error) return policy_gate.error;

  if (runtime_tool_approval_mode(tool) === 'review' && !policy_gate.approval_granted) {
    return {
      success: false,
      error: {
        code: 'approval_required',
        message: `${tool.node_key} requires manual approval before execution.`,
      },
    };
  }

  try {
    return await run_with_timeout(
      platform_tool_timeout_ms(tool, tool_input),
      input.signal,
      (signal) =>
        tool.execute(
          tool_input as never,
          runtime_tool_context(db, { ...input, signal }, tool_call_id),
        ),
    );
  } catch (error) {
    if (!(error instanceof PolicyTimeoutError)) throw error;
    return {
      success: false,
      error: {
        code: 'timed_out',
        message: `${tool.node_key} exceeded ${error.timeout_ms}ms timeout`,
      },
    };
  }
}

export function platform_tool_timeout_ms(tool: PlatformTool, tool_input: unknown) {
  return tool.policy_timeout_ms?.(tool_input as never) ?? default_platform_tool_timeout_ms;
}

async function evaluate_platform_tool_policy(
  db: Database,
  input: ExecuteRuntimeToolInput,
  tool: PlatformTool,
  tool_input: unknown,
): Promise<ToolPolicyGateResult> {
  if (tool.metadata.policy_delegates_to_catalog === true) {
    return { error: null, approval_granted: false };
  }
  return evaluate_tool_policy_gate(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    actor_id: input.actor_id,
    ...(input.speaker?.source_actor_id ? { acting_actor_id: input.speaker.source_actor_id } : {}),
    node_key: input.node_key,
    tool_input,
    connection_id: await find_platform_tool_policy_connection_id(db, input, tool),
    approval_policy: tool.approval_policy,
    metadata: tool.metadata,
    ...(input.source_context ? { source_context: input.source_context } : {}),
  });
}

function runtime_tool_context(
  db: Database,
  input: ExecuteRuntimeToolInput,
  tool_call_id: string,
): PlatformRuntimeToolExecutionContext {
  return {
    db,
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    tool_call_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    actor_id: input.actor_id,
    ...(input.participants ? { participants: input.participants } : {}),
    ...room_of_parent_call(input),
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.attachment_sources ? { attachment_sources: input.attachment_sources } : {}),
    ...(input.source_context ? { source_context: input.source_context } : {}),
    ...(input.speaker ? { speaker: input.speaker } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

const held_for_a_person_status = 'awaiting_approval';

async function record_tool_call_started(
  db: Database,
  input: ExecuteRuntimeToolInput,
  tool_call: ToolCall,
  tool_name: string,
) {
  try {
    const started_event = await create_tool_call_started_event(db, input, tool_call, tool_name);
    await announce_tool_call_started(input.emit_chat_stream_event_drafts, tool_call, started_event);
  } catch (error) {
    log.error('recording the started tool call event failed', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      tool_call_id: tool_call.tool_call_id,
      error: format_error_message(error),
    });
  }
}

function announce_tool_call_started(
  sink: ChatStreamEventDraftSink | undefined,
  tool_call: PersistedToolCallForChatStream,
  started_event: Awaited<ReturnType<typeof create_tool_call_lifecycle_event>>,
) {
  if (tool_call.tool_status === held_for_a_person_status) return;
  return emit_tool_call_chat_stream_event(sink, [
    create_tool_call_started_chat_event_draft({
      tool_call,
      source_run_event_id: started_event.run_event_id,
      source_event_sequence: started_event.event_sequence,
    }),
  ]);
}

// The started event is an intermittent Supabase-pooler write casualty (~5x/week). One retry
// absorbs the transient blip; a second failure is reported by the caller and the tool proceeds.
async function create_tool_call_started_event(
  db: Database,
  input: ExecuteRuntimeToolInput,
  tool_call: ToolCall,
  tool_name: string,
) {
  const event_input = {
    ...input,
    tool_call_id: tool_call.tool_call_id,
    tool_name,
    event_label: 'tool_call.started',
    event_data: { tool_status: 'executing' as const },
  };
  try {
    return await create_tool_call_lifecycle_event(db, event_input);
  } catch {
    return await create_tool_call_lifecycle_event(db, event_input);
  }
}

async function save_platform_tool_result(
  db: Database,
  input: ExecuteRuntimeToolInput,
  output: {
    tool: PlatformTool;
    tool_call: ToolCall;
    result: PlatformRuntimeToolResult;
    duration_ms: number;
    result_is_stored: boolean;
  },
) {
  const tool_status = runtime_tool_result_status(output.result);
  const [finished_call, finished_event] = await Promise.all([
    update_tool_call_finished(db, {
      tool_call_id: output.tool_call.tool_call_id,
      tool_status,
      ...unstored_output_fields(
        output.result_is_stored,
        output.result,
        stringify_tool_result(output.result),
      ),
      error_code: output.result.success ? null : output.result.error.code,
      error_message: output.result.success ? null : output.result.error.message,
      ...tool_call_reference_fields(output.result.metadata),
      duration_ms: output.duration_ms,
      actor_id: input.actor_id,
    }),
    create_tool_call_lifecycle_event(db, {
      ...input,
      tool_call_id: output.tool_call.tool_call_id,
      tool_name: output.tool.node_key,
      event_label: tool_lifecycle_label_for_status(tool_status),
      event_data: {
        tool_status,
        duration_ms: output.duration_ms,
        ...(output.result.success ? {} : { error_code: output.result.error.code }),
      },
    }),
    create_usage_record(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      usage_kind: 'tool_call',
      quantity: '1',
      unit: 'call',
      provider: output.tool.app_name,
      actor_id: input.actor_id,
    }),
  ]);
  const finished_with_output = with_tool_call_output(finished_call, output.result);
  await emit_finished_tool_call(input, finished_with_output, finished_event);
  return finished_with_output;
}

function unstored_output_fields(result_is_stored: boolean, output: unknown, output_text: string) {
  return result_is_stored ? {} : { output, output_text };
}

async function save_platform_tool_failure(
  db: Database,
  input: ExecuteRuntimeToolInput,
  output: {
    tool: PlatformTool;
    tool_call: ToolCall;
    result: Extract<PlatformRuntimeToolResult, { success: false }>;
    duration_ms: number;
    result_is_stored: boolean;
  },
) {
  const tool_status = runtime_tool_result_status(output.result);
  const [finished_call, failed_event] = await Promise.all([
    update_tool_call_finished(db, {
      tool_call_id: output.tool_call.tool_call_id,
      tool_status,
      ...unstored_output_fields(
        output.result_is_stored,
        output.result,
        output.result.error.message,
      ),
      error_code: output.result.error.code,
      error_message: output.result.error.message,
      duration_ms: output.duration_ms,
      actor_id: input.actor_id,
    }),
    create_tool_call_lifecycle_event(db, {
      ...input,
      tool_call_id: output.tool_call.tool_call_id,
      tool_name: output.tool.node_key,
      event_label: tool_lifecycle_label_for_status(tool_status),
      event_data: { tool_status, error_code: output.result.error.code },
    }),
  ]);
  const finished_with_output = with_tool_call_output(finished_call, output.result);
  await emit_finished_tool_call(input, finished_with_output, failed_event);
  return finished_with_output;
}

function save_platform_tool_result_message(
  db: Database,
  input: ExecuteRuntimeToolInput,
  output: {
    tool_call: ToolCall;
    tool_name: string;
    result: PlatformRuntimeToolResult;
    result_is_stored: boolean;
  },
) {
  return create_persisted_tool_result_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    tool_call_id: output.tool_call.tool_call_id,
    ...(input.model_tool_call_id === undefined
      ? {}
      : { model_tool_call_id: input.model_tool_call_id }),
    tool_name: output.tool_name,
    result: platform_tool_result_to_runtime_tool_result(output.result),
    result_is_stored_on_tool_call: output.result_is_stored,
    ...(input.tool_result_is_user_visible === undefined
      ? {}
      : { is_user_visible: input.tool_result_is_user_visible }),
    ...(input.tool_result_is_model_visible === undefined
      ? {}
      : { is_model_visible: input.tool_result_is_model_visible }),
    actor_id: input.actor_id,
  });
}

function emit_finished_tool_call(
  input: ExecuteRuntimeToolInput,
  tool_call: Awaited<ReturnType<typeof update_tool_call_finished>>,
  event: Awaited<ReturnType<typeof create_tool_call_lifecycle_event>>,
) {
  return emit_tool_call_chat_stream_event(input.emit_chat_stream_event_drafts, [
    create_tool_call_completed_chat_event_draft({
      tool_call,
      source_run_event_id: event.run_event_id,
      source_event_sequence: event.event_sequence,
    }),
  ]);
}

function platform_tool_failure(
  error: unknown,
): Extract<PlatformRuntimeToolResult, { success: false }> {
  return {
    success: false,
    error: {
      code: 'tool_execution_failed',
      message: format_error_message(error, 'Tool execution failed'),
    },
  };
}

async function execute_workspace_tool(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    agent_id?: string;
    runtime_environment_id?: string;
    emit_chat_stream_event_drafts?: ChatStreamEventDraftSink;
    tool_result_is_user_visible?: boolean;
    actor_id: string;
    tool: WorkspaceToolDefinition;
    tool_input: unknown;
    context: RuntimeToolContext;
    after_write_hooks?: readonly AfterWorkspaceWriteHook[] | undefined;
  },
): Promise<RuntimeToolResult> {
  const started_at = Date.now();
  const tool_input = workspace_tool_input_record_schema.parse(input.tool_input);
  const existing_call = await find_existing_workspace_tool_call(db, input);
  const repeat: RepeatDecision = existing_call
    ? await decide_how_to_repeat(
        db,
        repeat_context({
          ...input,
          ...(input.context.signal ? { signal: input.context.signal } : {}),
        }),
        existing_call,
        input.context.tool_call_id,
      )
    : { action: 'run' };
  if (existing_call && repeat.action === 'wait') {
    return platform_tool_result_to_runtime_tool_result(still_waiting_for_a_person_result());
  }
  if (existing_call && repeat.action === 'reuse_saved_result') {
    return reuse_saved_workspace_result(db, input, existing_call, repeat.saved);
  }
  const tool_call = existing_call ?? (await start_workspace_tool_call(db, input, tool_input));
  const started_event = await create_tool_call_lifecycle_event(db, {
    ...input,
    tool_call_id: tool_call.tool_call_id,
    tool_name: input.tool.tool_name,
    event_label: 'tool_call.started',
    event_data: { tool_status: 'executing' },
  });
  await announce_tool_call_started(input.emit_chat_stream_event_drafts, tool_call, started_event);

  const result =
    repeat.action === 'answer'
      ? platform_tool_result_to_runtime_tool_result(repeat.result)
      : await run_workspace_tool_then_after_write_hooks(input, tool_input, tool_call.tool_call_id);
  await persist_workspace_tool_side_effects(db, {
    ...(input.runtime_environment_id === undefined
      ? {}
      : { runtime_environment_id: input.runtime_environment_id }),
    result,
    actor_id: input.actor_id,
  });
  const produced_artifact = await create_produced_workspace_artifact(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.runtime_environment_id === undefined
      ? {}
      : { runtime_environment_id: input.runtime_environment_id }),
    source_tool_call_id: tool_call.tool_call_id,
    actor_id: input.actor_id,
    context: input.context,
    result,
  });
  const result_with_artifact = produced_artifact
    ? with_result_metadata(result, { file_id: produced_artifact.file_id })
    : result;
  const visible_output = await limit_workspace_tool_output(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.runtime_environment_id === undefined
      ? {}
      : { runtime_environment_id: input.runtime_environment_id }),
    source_tool_call_id: tool_call.tool_call_id,
    actor_id: input.actor_id,
    context: input.context,
    result: result_with_artifact,
  });
  const visible_result = visible_output.result;
  const duration_ms = Date.now() - started_at;
  const result_is_stored = await store_result_on_tool_call(db, input, {
    tool_call_id: tool_call.tool_call_id,
    output: tool_result_v2_from_runtime_result(visible_result),
    output_text: runtime_tool_result_text(visible_result),
    output_file_id: visible_output.output_file_id,
  });
  await defer_run_write(input.run_id, 'workspace activity', () =>
    append_workspace_activity(
      { ...input.context, ...pick_workspace_call_identity(input) },
      workspace_activity_entry({ ...input, tool_name: input.tool.tool_name }, visible_result),
    ),
  );
  await defer_run_write(input.run_id, 'tool call outcome', () =>
    save_workspace_tool_outcome(db, input, {
      tool_call,
      visible_result,
      duration_ms,
      result_is_stored,
      ...(visible_output.output_file_id === undefined
        ? {}
        : { output_file_id: visible_output.output_file_id }),
    }),
  );
  await create_persisted_tool_result_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    tool_call_id: tool_call.tool_call_id,
    ...(input.context.tool_call_id === undefined
      ? {}
      : { model_tool_call_id: input.context.tool_call_id }),
    tool_name: input.tool.tool_name,
    result: visible_result,
    result_is_stored_on_tool_call: result_is_stored,
    ...(input.tool_result_is_user_visible === undefined
      ? {}
      : { is_user_visible: input.tool_result_is_user_visible }),
    actor_id: input.actor_id,
  });

  return {
    ...visible_result,
    metadata: {
      ...visible_result.metadata,
      tool_call_id: tool_call.tool_call_id,
    },
  };
}

async function run_workspace_tool_then_after_write_hooks(
  input: Parameters<typeof execute_workspace_tool>[1],
  tool_input: Record<string, unknown>,
  tool_call_id: string,
) {
  const result = stopped_result_when_run_was_stopped(
    await run_workspace_tool_with_policy(input.tool, tool_input, input.context),
    input.context.signal,
  );
  const { after_write_hooks, tool, context } = input;
  return run_after_workspace_write_hooks(
    after_write_hooks,
    {
      ...pick_workspace_call_identity(input),
      tool_name: tool.tool_name,
      tool_call_id,
      tool_input,
      environment: context.environment,
      result,
    },
    context.signal,
  );
}

function pick_workspace_call_identity(input: Parameters<typeof execute_workspace_tool>[1]) {
  const { workspace_id, session_id, run_id, agent_id, actor_id } = input;
  return { workspace_id, session_id, run_id, ...(agent_id ? { agent_id } : {}), actor_id };
}

async function reuse_saved_workspace_result(
  db: Database,
  input: Parameters<typeof execute_workspace_tool>[1],
  tool_call: ToolCall,
  saved: SavedToolResult,
): Promise<RuntimeToolResult> {
  const result = saved_workspace_result(saved.output);
  if (!tool_call_has_finished(tool_call)) {
    await save_workspace_tool_outcome(db, input, {
      tool_call,
      visible_result: result,
      duration_ms: unmeasured_duration_ms,
      result_is_stored: saved.result_is_stored,
    });
  }
  await create_persisted_tool_result_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    tool_call_id: tool_call.tool_call_id,
    ...(input.context.tool_call_id === undefined
      ? {}
      : { model_tool_call_id: input.context.tool_call_id }),
    tool_name: input.tool.tool_name,
    result,
    result_is_stored_on_tool_call: saved.result_is_stored,
    ...(input.tool_result_is_user_visible === undefined
      ? {}
      : { is_user_visible: input.tool_result_is_user_visible }),
    actor_id: input.actor_id,
  });
  return { ...result, metadata: { ...result.metadata, tool_call_id: tool_call.tool_call_id } };
}

function saved_workspace_result(output: unknown): RuntimeToolResult {
  const is_catalog_envelope = typeof output === 'object' && output !== null && 'success' in output;
  return is_catalog_envelope
    ? platform_tool_result_to_runtime_tool_result(output as PlatformRuntimeToolResult)
    : (output as RuntimeToolResult);
}

async function save_workspace_tool_outcome(
  db: Database,
  input: Parameters<typeof execute_workspace_tool>[1],
  output: {
    tool_call: ToolCall;
    visible_result: RuntimeToolResult;
    duration_ms: number;
    result_is_stored: boolean;
    output_file_id?: string;
  },
) {
  const { visible_result } = output;
  const finished_row = await update_tool_call_finished(db, {
    tool_call_id: output.tool_call.tool_call_id,
    tool_status: visible_result.ok
      ? 'completed'
      : workspace_error_status(visible_result.error_code),
    ...unstored_output_fields(
      output.result_is_stored,
      visible_result,
      runtime_tool_result_text(visible_result),
    ),
    ...(output.output_file_id === undefined || output.result_is_stored
      ? {}
      : { output_file_id: output.output_file_id }),
    error_code: visible_result.ok ? null : visible_result.error_code,
    error_message: visible_result.ok ? null : visible_result.error_message,
    duration_ms: output.duration_ms,
    actor_id: input.actor_id,
  });
  const finished_call = with_tool_call_output(finished_row, visible_result);
  const [finished_event] = await Promise.all([
    create_tool_call_lifecycle_event(db, {
      ...input,
      tool_call_id: finished_call.tool_call_id,
      tool_name: input.tool.tool_name,
      event_label: tool_lifecycle_label_for_status(finished_call.tool_status),
      event_data: {
        tool_status: finished_call.tool_status,
        duration_ms: finished_call.duration_ms ?? 0,
        ...(visible_result.ok ? {} : { error_code: visible_result.error_code }),
      },
    }),
    create_usage_record(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      usage_kind: 'tool_call',
      quantity: '1',
      unit: 'call',
      provider: 'workspace',
      actor_id: input.actor_id,
    }),
  ]);
  await emit_tool_call_chat_stream_event(input.emit_chat_stream_event_drafts, [
    create_tool_call_completed_chat_event_draft({
      tool_call: finished_call,
      source_run_event_id: finished_event.run_event_id,
      source_event_sequence: finished_event.event_sequence,
    }),
  ]);
}

async function find_existing_workspace_tool_call(
  db: Database,
  input: Parameters<typeof execute_workspace_tool>[1],
) {
  const idempotency_key = tool_call_idempotency_key({
    run_id: input.run_id,
    model_tool_call_id: input.context.tool_call_id,
  });
  if (!idempotency_key) return null;
  return find_tool_call_by_idempotency_key(db, {
    workspace_id: input.workspace_id,
    idempotency_key,
  });
}

async function start_workspace_tool_call(
  db: Database,
  input: Parameters<typeof execute_workspace_tool>[1],
  tool_input: Record<string, unknown>,
) {
  const idempotency_key = tool_call_idempotency_key({
    run_id: input.run_id,
    model_tool_call_id: input.context.tool_call_id,
  });
  const write_path = write_path_of(input.tool.tool_name, tool_input);
  return create_tool_call_started(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    tool_name: input.tool.tool_name,
    tool_input,
    risk_class: input.tool.policy.risk_class,
    approval_mode: input.tool.policy.approval_mode,
    idempotency_key,
    tool_call_metadata: {
      policy: input.tool.policy,
      runtime_environment_id: input.runtime_environment_id ?? null,
      runtime_tool_call_id: input.context.tool_call_id ?? null,
      workspace_dir: input.context.environment?.working_directory ?? null,
      ...(write_path === null ? {} : { write_path }),
    },
    actor_id: input.actor_id,
  });
}

export function create_logged_tool_definition(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    agent_id?: string | undefined;
    runtime_environment_id?: string | undefined;
    emit_chat_stream_event_drafts?: ChatStreamEventDraftSink | undefined;
    tool_result_is_user_visible?: boolean | undefined;
    actor_id: string;
  },
  tool: AgentRuntimeToolDefinition,
  policy: RuntimeToolPolicy,
): AgentRuntimeToolDefinition {
  return {
    ...tool,
    execute: (tool_input, context) =>
      execute_workspace_tool(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        run_id: input.run_id,
        ...(input.agent_id ? { agent_id: input.agent_id } : {}),
        ...(input.runtime_environment_id
          ? { runtime_environment_id: input.runtime_environment_id }
          : {}),
        tool: {
          tool_name: tool.tool_name,
          description: tool.description,
          input_schema: tool.input_schema ?? object_schema({}),
          policy,
          execute: (prepared_input, runtime_context) => {
            if (!tool.execute) {
              return Promise.resolve(
                err('tool_not_executable', `Tool is not executable: ${tool.tool_name}`),
              );
            }
            return tool.execute(prepared_input, runtime_context);
          },
        },
        tool_input,
        context,
        ...(input.emit_chat_stream_event_drafts
          ? { emit_chat_stream_event_drafts: input.emit_chat_stream_event_drafts }
          : {}),
        ...(input.tool_result_is_user_visible === undefined
          ? {}
          : { tool_result_is_user_visible: input.tool_result_is_user_visible }),
        actor_id: input.actor_id,
      }),
  };
}

export function stringify_tool_result(result: unknown) {
  return cap_model_visible_tool_text(JSON.stringify(result) ?? String(result));
}

export async function create_persisted_tool_result_message(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    tool_call_id: string;
    model_tool_call_id?: string;
    tool_name: string;
    result: RuntimeToolResult;
    result_is_stored_on_tool_call: boolean;
    is_user_visible?: boolean;
    is_model_visible?: boolean;
    actor_id: string;
  },
) {
  const stored_content = tool_result_message_row_content(input);
  const held_result = await replace_tool_result_message(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    tool_call_id: input.tool_call_id,
    ...stored_content,
    ...(input.is_user_visible === undefined ? {} : { is_user_visible: input.is_user_visible }),
    actor_id: input.actor_id,
  });
  if (held_result) return held_result;

  const message = await create_run_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    message_role: 'tool_result',
    ...stored_content,
    source_type: 'tool',
    tool_call_id: input.tool_call_id,
    is_model_visible: input.is_model_visible ?? true,
    is_user_visible: input.is_user_visible ?? true,
    source_metadata: {
      tool_name: input.tool_name,
      ...(input.model_tool_call_id === undefined
        ? {}
        : { model_tool_call_id: input.model_tool_call_id }),
    },
    actor_id: input.actor_id,
  });

  await create_usage_record(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    usage_kind: 'message',
    quantity: '1',
    unit: 'message',
    provider: 'tool',
    actor_id: input.actor_id,
  });

  return message;
}

function tool_result_message_row_content(input: {
  tool_call_id: string;
  model_tool_call_id?: string;
  tool_name: string;
  result: RuntimeToolResult;
  result_is_stored_on_tool_call: boolean;
}) {
  const message_content = tool_result_message_content(input);
  if (!input.result_is_stored_on_tool_call) return { message_content };
  return {
    message_content: tool_result_message_pointer(input.tool_call_id),
    content_text: tool_result_text_preview(input.result),
    token_count: estimate_model_visible_message_tokens(message_content),
  };
}

function tool_call_reference_fields(metadata: Record<string, unknown> | undefined) {
  const node_provenance = metadata?.node_provenance;
  const has_node_provenance =
    typeof node_provenance === 'object' &&
    node_provenance !== null &&
    !Array.isArray(node_provenance);
  return {
    ...(typeof metadata?.node_id === 'string' ? { node_id: metadata.node_id } : {}),
    ...(typeof metadata?.node_version === 'number' ? { node_version: metadata.node_version } : {}),
    ...(typeof metadata?.connection_id === 'string'
      ? { connection_id: metadata.connection_id }
      : {}),
    ...(has_node_provenance ? { tool_call_metadata_patch: { node_provenance } } : {}),
  };
}

function runtime_tool_approval_mode(
  tool: PlatformRuntimeToolDefinition,
): RuntimeToolPolicy['approval_mode'] {
  return tool.approval_policy.mode === 'manual_review' ? 'review' : 'auto';
}

function runtime_tool_risk_class(
  tool: PlatformRuntimeToolDefinition,
): RuntimeToolPolicy['risk_class'] {
  if (tool.category === 'communication' && runtime_tool_approval_mode(tool) === 'review') {
    return 'send';
  }
  return 'read';
}

function runtime_tool_result_status(result: { success: boolean; error?: { code: string } }) {
  if (result.success) return 'completed' as const;
  if (
    [
      'approval_required',
      'blocked_by_policy',
      'tool_approval_unavailable',
      'tool_blocked_by_workspace_policy',
    ].includes(result.error?.code ?? '')
  ) {
    return 'blocked' as const;
  }
  if (result.error?.code === 'timed_out') return 'timed_out' as const;
  if (result.error?.code === 'repeat_declined') return 'denied' as const;
  return 'failed' as const;
}

function tool_lifecycle_label_for_status(status: string) {
  if (status === 'completed') return 'tool_call.completed';
  if (status === 'timed_out') return 'tool_call.timed_out';
  if (status === 'blocked') return 'tool_call.blocked';
  return 'tool_call.error';
}

export async function create_tool_call_lifecycle_event(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    tool_call_id: string;
    tool_name: string;
    event_label: string;
    event_data: Record<string, unknown>;
    actor_id: string;
  },
) {
  return create_stored_run_event(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    tool_call_id: input.tool_call_id,
    event_type: 'progress',
    event_label: input.event_label,
    event_data: {
      tool_call_id: input.tool_call_id,
      tool_name: input.tool_name,
      ...input.event_data,
    },
    actor_id: input.actor_id,
  });
}

async function emit_tool_call_chat_stream_event(
  sink: ChatStreamEventDraftSink | undefined,
  drafts: ChatStreamEventDraft[],
) {
  if (!sink) return;
  await sink(drafts);
}

export function create_runtime_tool_definitions(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    agent_id?: string;
    runtime_environment_id?: string;
    environment?: RuntimeToolContext['environment'];
    attachment_sources?: ReadonlyMap<string, RuntimeAttachmentSource>;
    source_context?: RuntimeToolSourceContext;
    speaker?: RuntimeToolSpeaker;
    emit_chat_stream_event_drafts?: ChatStreamEventDraftSink;
    tool_result_is_user_visible?: boolean;
    connected_app_names?: ReadonlySet<string>;
    hidden_tool_names?: ReadonlySet<string>;
    allowed_tool_names?: readonly string[];
    participants?: Participants;
    room_private_to?: string | null | undefined;
    read_approval_grant?: (model_tool_call_id: string) => ToolPolicyApprovalGrantData | undefined;
    actor_id: string;
    after_write_hooks?: readonly AfterWorkspaceWriteHook[];
  },
): AgentRuntimeToolDefinition[] {
  return [
    ...(can_expose_pi_coding_tools(input.environment)
      ? create_pi_coding_tool_definitions(db, input)
      : []),
    ...tools_the_sandbox_serves(create_workspace_tool_definitions(db, input), input.environment),
    ...create_browser_tool_definitions(db, input),
    ...get_all_tools()
      .filter((tool) => !input.hidden_tool_names?.has(tool.node_key))
      .filter((tool) => is_tool_offered_on_source(tool, input.source_context?.source_type))
      .filter((tool) => is_tool_connection_satisfied(tool, input.connected_app_names))
      .map((tool): AgentRuntimeToolDefinition => {
        const execution_mode: RuntimeToolExecutionMode =
          tool.approval_policy.mode === 'manual_review' || tool.waits_for_a_person
            ? 'sequential'
            : 'parallel';
        return {
          tool_name: tool.node_key,
          description: tool.description,
          ...(tool.input_schema === undefined ? {} : { input_schema: tool.input_schema }),
          ...(tool.output_schema === undefined ? {} : { output_schema: tool.output_schema }),
          execution_mode,
          metadata: {
            display_name: tool.display_name,
            category: tool.category,
            app_name: tool.app_name,
            required_connection: tool.required_connection,
            approval_policy: tool.approval_policy,
            runtime_handler: tool.runtime_handler,
            ...tool.metadata,
          },
          ...(tool.ends_run_on_success ? { ends_run_on_success: true } : {}),
          async execute(tool_input: unknown, context: RuntimeToolContext) {
            const source_context = with_approval_grant(
              source_context_for_tool(tool, input.source_context),
              context.tool_call_id ? input.read_approval_grant?.(context.tool_call_id) : undefined,
            );
            const environment = context.environment ?? input.environment;
            const execution = await execute_runtime_tool(db, {
              workspace_id: input.workspace_id,
              session_id: input.session_id,
              run_id: input.run_id,
              ...(input.agent_id ? { agent_id: input.agent_id } : {}),
              node_key: tool.node_key,
              tool_input,
              ...(context.signal === undefined ? {} : { signal: context.signal }),
              ...(context.tool_call_id === undefined
                ? {}
                : { model_tool_call_id: context.tool_call_id }),
              ...(environment ? { environment } : {}),
              ...(input.attachment_sources ? { attachment_sources: input.attachment_sources } : {}),
              ...(source_context ? { source_context } : {}),
              ...(input.speaker ? { speaker: input.speaker } : {}),
              ...(input.participants ? { participants: input.participants } : {}),
              room_private_to: input.room_private_to,
              ...(input.emit_chat_stream_event_drafts
                ? { emit_chat_stream_event_drafts: input.emit_chat_stream_event_drafts }
                : {}),
              ...(input.tool_result_is_user_visible === undefined
                ? {}
                : { tool_result_is_user_visible: input.tool_result_is_user_visible }),
              actor_id: input.actor_id,
              tool_context_metadata: context.metadata,
            });

            return platform_result_to_model_tool_result(execution.result);
          },
        };
      }),
  ];
}

function can_expose_pi_coding_tools(environment: RuntimeToolContext['environment'] | undefined) {
  return !environment || environment.env_kind === 'local';
}

function is_tool_offered_on_source(
  tool: PlatformRuntimeToolDefinition,
  source_type: RuntimeToolSourceType | undefined,
) {
  if (!tool.available_on_source_types) return true;
  return source_type !== undefined && tool.available_on_source_types.includes(source_type);
}

function is_tool_connection_satisfied(
  tool: PlatformRuntimeToolDefinition,
  connected_app_names: ReadonlySet<string> | undefined,
) {
  if (!tool.required_connection) return true;
  if (connected_app_names === undefined) return true;
  return connected_app_names.has(tool.app_name);
}

function source_context_for_tool(
  tool: PlatformRuntimeToolDefinition,
  source_context: RuntimeToolSourceContext | undefined,
) {
  if (tool.source_context_policy?.mode !== 'current_turn') return undefined;
  return source_context;
}

type WorkspaceToolDefinitionsInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string;
  runtime_environment_id?: string;
  environment?: RuntimeToolContext['environment'];
  emit_chat_stream_event_drafts?: ChatStreamEventDraftSink;
  tool_result_is_user_visible?: boolean;
  actor_id: string;
  after_write_hooks?: readonly AfterWorkspaceWriteHook[];
};

function create_pi_coding_tool_definitions(
  db: Database,
  input: WorkspaceToolDefinitionsInput,
): AgentRuntimeToolDefinition[] {
  return create_built_in_tools().map((tool): AgentRuntimeToolDefinition => {
    const policy = pi_coding_tool_policy(tool.tool_name);

    return {
      tool_name: tool.tool_name,
      description: tool.description,
      ...(tool.input_schema === undefined ? {} : { input_schema: tool.input_schema }),
      ...(tool.output_schema === undefined ? {} : { output_schema: tool.output_schema }),
      execution_mode: 'parallel',
      metadata: {
        ...tool.metadata,
        display_name: tool.metadata?.display_name ?? tool.tool_name,
        category: 'workspace',
        policy,
        runtime_handler: tool.tool_name,
      },
      execute: (tool_input, context) =>
        execute_workspace_tool(db, {
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          run_id: input.run_id,
          ...(input.agent_id ? { agent_id: input.agent_id } : {}),
          ...(input.runtime_environment_id
            ? { runtime_environment_id: input.runtime_environment_id }
            : {}),
          tool: {
            tool_name: tool.tool_name,
            description: tool.description,
            input_schema: (tool.input_schema ?? object_schema({})) as RuntimeJsonSchema,
            policy,
            execute: async (prepared_input, runtime_context) => {
              if (!tool.execute) {
                return err(
                  'pi_coding_tool_not_executable',
                  `Pi coding tool is not executable: ${tool.tool_name}`,
                );
              }

              return tool.execute(prepared_input, runtime_context);
            },
          },
          tool_input,
          context: {
            ...context,
            ...(input.environment === undefined ? {} : { environment: input.environment }),
          },
          after_write_hooks: input.after_write_hooks,
          ...(input.emit_chat_stream_event_drafts
            ? { emit_chat_stream_event_drafts: input.emit_chat_stream_event_drafts }
            : {}),
          ...(input.tool_result_is_user_visible === undefined
            ? {}
            : { tool_result_is_user_visible: input.tool_result_is_user_visible }),
          actor_id: input.actor_id,
        }),
    };
  });
}

function create_workspace_tool_definitions(
  db: Database,
  input: WorkspaceToolDefinitionsInput,
): AgentRuntimeToolDefinition[] {
  return workspace_file_tools.map((tool): AgentRuntimeToolDefinition => {
    return {
      tool_name: tool.tool_name,
      description: tool.description,
      input_schema: tool.input_schema,
      execution_mode: 'parallel',
      metadata: {
        display_name: tool.tool_name,
        category: 'workspace',
        policy: tool.policy,
        runtime_handler: tool.tool_name,
        ...(tool.approval_display_fields
          ? { approval_display_fields: tool.approval_display_fields }
          : {}),
      },
      execute: (tool_input, context) =>
        execute_workspace_tool(db, {
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          run_id: input.run_id,
          ...(input.agent_id ? { agent_id: input.agent_id } : {}),
          ...(input.runtime_environment_id
            ? { runtime_environment_id: input.runtime_environment_id }
            : {}),
          tool,
          tool_input,
          context: {
            ...context,
            ...(input.environment === undefined ? {} : { environment: input.environment }),
          },
          after_write_hooks: input.after_write_hooks,
          ...(input.emit_chat_stream_event_drafts
            ? { emit_chat_stream_event_drafts: input.emit_chat_stream_event_drafts }
            : {}),
          ...(input.tool_result_is_user_visible === undefined
            ? {}
            : { tool_result_is_user_visible: input.tool_result_is_user_visible }),
          actor_id: input.actor_id,
        }),
    };
  });
}

function pi_coding_tool_policy(tool_name: string): RuntimeToolPolicy {
  if (tool_name === 'bash') return workspace_policy('exec');
  if (tool_name === 'write' || tool_name === 'edit') return workspace_policy('write');
  return workspace_policy('read');
}

function define_workspace_tool<InputSchema extends z.ZodType>(
  definition: WorkspaceToolDefinition<InputSchema>,
) {
  return definition;
}

const nonempty_string_schema = z.string().min(1);
const workspace_tool_input_record_schema = z.record(z.string(), z.unknown());
const workspace_list_files_input_schema = z
  .object({
    path: z.string().optional(),
    recursive: z.boolean().optional(),
    max_depth: z.number().finite().optional(),
  })
  .strict();
const workspace_path_input_schema = z.object({ path: nonempty_string_schema }).strict();
const workspace_read_file_input_schema = z
  .object({
    path: nonempty_string_schema,
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
const workspace_write_file_input_schema = z
  .object({ path: nonempty_string_schema, content: nonempty_string_schema })
  .strict();
const workspace_edit_file_input_schema = z
  .object({
    path: nonempty_string_schema,
    old_text: nonempty_string_schema,
    new_text: nonempty_string_schema,
    replace_all: z.boolean().optional(),
  })
  .strict();
const workspace_grep_input_schema = z
  .object({
    pattern: nonempty_string_schema,
    path: z.string().optional(),
    case_sensitive: z.boolean().optional(),
    max_results: z.number().finite().optional(),
  })
  .strict();
const workspace_glob_input_schema = z
  .object({ pattern: nonempty_string_schema, max_results: z.number().finite().optional() })
  .strict();
const workspace_command_input_schema = z
  .object({
    command: nonempty_string_schema,
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    writable_paths: z.array(z.string()).optional(),
    timeout_ms: z.number().finite().optional(),
  })
  .strict();
const workspace_start_background_command_input_schema = z
  .object({
    command: nonempty_string_schema,
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  })
  .strict();
const workspace_check_background_command_input_schema = z
  .object({
    background_command_id: nonempty_string_schema,
    wait_seconds: z.number().finite().optional(),
  })
  .strict();
const workspace_stop_background_command_input_schema = z
  .object({ background_command_id: nonempty_string_schema })
  .strict();

const workspace_root = e2b_workspace_root;

const workspace_path_rule = `Resolved under ${workspace_root}; the sandbox's own /tmp is outside it, put scratch files in tmp/.`;
const workspace_path_examples = ['repo/src/index.ts', 'tmp/scratch.json', 'artifacts/report.pdf'];

const workspace_file_tools: WorkspaceToolDefinition[] = [
  define_workspace_tool({
    tool_name: 'workspace-list_files',
    description: 'List files under the sandbox workspace root.',
    input_schema: object_schema({
      path: workspace_path_schema('Workspace path to list. Defaults to workspace root.'),
      recursive: boolean_schema('Whether to list recursively.'),
      max_depth: number_schema('Maximum recursive depth.'),
    }),
    validate_input: workspace_list_files_input_schema,
    policy: workspace_policy('read'),
    execute: async (input, context) => {
      const environment = require_workspace_environment(context);
      const max_depth = input.max_depth;
      const entries = await environment.list?.({
        path: canonical_workspace_file_path(input.path?.trim() || '.'),
        recursive: input.recursive ?? false,
        ...(max_depth === undefined ? {} : { max_depth }),
      });
      return ok_json(entries ?? []);
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-read_file',
    description:
      'Read a UTF-8 file from the sandbox. Long files come back truncated with the line range ' +
      'shown; pass `offset` to continue from where the last read stopped.',
    input_schema: object_schema(
      {
        path: workspace_path_schema('Sandbox file path to read.'),
        offset: number_schema('Line number to start reading from (1-indexed).'),
        limit: number_schema('Maximum number of lines to read.'),
      },
      ['path'],
    ),
    validate_input: workspace_read_file_input_schema,
    policy: workspace_policy('read'),
    execute: async (input, context) => {
      const parts = await read_file_with_pi(require_workspace_environment(context), {
        workspace_path: canonical_workspace_file_path(input.path),
        ...(input.offset === undefined ? {} : { offset: input.offset }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        tool_call_id: context.tool_call_id ?? context.run_key,
      });
      return ok_text(
        parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
      );
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-read_document',
    description:
      'Read an office document from the sandbox as clean Markdown: Word (.doc/.docx), ' +
      'PowerPoint (.ppt/.pptx), Excel (.xls/.xlsx/.xlsb), OpenDocument (.odt/.ods/.odp), ' +
      'RTF, EPUB, CSV, and text-based PDF. Use this instead of writing a Python or shell ' +
      'parser — it returns headings, tables, and lists in one call. Scanned/image-only ' +
      'PDFs have no extractable text and come back empty.',
    input_schema: object_schema(
      { path: workspace_path_schema('Sandbox path of the document to read.') },
      ['path'],
    ),
    validate_input: workspace_path_input_schema,
    policy: workspace_policy('read'),
    execute: async (input, context) => {
      const workspace_path = canonical_workspace_file_path(input.path);
      const environment = require_workspace_environment(context);
      const bytes = environment.read_bytes
        ? await environment.read_bytes(workspace_path).catch(() => undefined)
        : undefined;
      if (bytes === undefined || bytes.byteLength === 0) {
        return err(
          'document_unreadable',
          `Could not read ${workspace_path}. Check the path exists and that this sandbox supports binary reads.`,
        );
      }
      if (bytes.byteLength > max_convertible_document_bytes) {
        return err(
          'document_too_large',
          `${workspace_path} is ${Math.round(bytes.byteLength / 1024 / 1024)}MB, over the ${Math.round(
            max_convertible_document_bytes / 1024 / 1024,
          )}MB conversion limit. Split it, or extract the part you need with a shell command.`,
        );
      }
      return convert_document_to_markdown(bytes, workspace_path);
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-view_image',
    description:
      'Look at an image file in the sandbox with your own eyes — it comes back as a ' +
      'picture you can actually see. Use it to review your own visual work before ' +
      'delivering it: rendered slides and document pages (render to PNG first with ' +
      'LibreOffice + Poppler), contact sheets, charts and plots, downloaded photos, and ' +
      'screenshots. Distortion, unreadable contrast, overlaps, and wrong-subject imagery ' +
      'are obvious to your eyes and invisible to printed checks. ' +
      'A larger image is shrunk to fit rather than turned away, and the reply says what size ' +
      'you are looking at — so read coordinates off that size, not off the file on disk. ' +
      'Rendering at 2000 pixels on the long edge in the first place (`pdftoppm -r 100` for a ' +
      'standard page) skips the shrink and keeps the detail you chose.',
    input_schema: object_schema(
      { path: workspace_path_schema('Sandbox path of an image file (png, jpg, jpeg, webp, gif).') },
      ['path'],
    ),
    validate_input: workspace_path_input_schema,
    policy: workspace_policy('read'),
    execute: async (input, context) => {
      const workspace_path = canonical_workspace_file_path(input.path);
      if (image_mime_type_for_path(workspace_path) === undefined) {
        return err(
          'unsupported_image_type',
          `Not a viewable image: ${workspace_path}. Supported: png, jpg, jpeg, webp, gif.`,
        );
      }
      const environment = require_workspace_environment(context);
      const bytes = environment.read_bytes
        ? await environment.read_bytes(workspace_path)
        : undefined;
      if (bytes === undefined || bytes.byteLength === 0) {
        return err(
          'image_unreadable',
          `Could not read image bytes at ${workspace_path}. Check the path exists and that this sandbox supports binary reads.`,
        );
      }
      const kilobytes = Math.round(bytes.byteLength / 1024);
      if (bytes.byteLength > max_viewable_image_bytes) {
        return err(
          'image_too_large',
          `Image ${workspace_path} is ${kilobytes}KB, over the ${Math.round(
            max_viewable_image_bytes / 1024 / 1024,
          )}MB limit for reading an image into memory. Render it smaller (e.g. pdftoppm -jpeg -r 110) and view that.`,
        );
      }
      const mime_type = sniff_image_mime_type(bytes);
      if (mime_type === undefined) {
        return err(
          'not_an_image',
          `File ${workspace_path} is not a recognized image (no PNG/JPEG/GIF/WebP signature). Re-render it before viewing.`,
        );
      }
      const data = Buffer.from(bytes).toString('base64');
      const size = read_image_dimensions(bytes);
      const dimensions = size ? `, ${size.width}x${size.height}` : '';
      const summary = `Viewing ${workspace_path} (${mime_type}${dimensions}, ${kilobytes}KB).`;
      return await ok_image(summary, data, mime_type, { workspace_path });
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-write_file',
    description: 'Write a UTF-8 file under the sandbox workspace root.',
    input_schema: object_schema(
      {
        path: workspace_path_schema('Sandbox file path to write.'),
        content: string_schema('File contents.'),
      },
      ['path', 'content'],
    ),
    validate_input: workspace_write_file_input_schema,
    policy: workspace_policy('write'),
    execute: async (input, context) => {
      const workspace_path = canonical_workspace_file_path(input.path);
      const refusal = reserved_path_refusal(workspace_path, workspace_layout_in(context));
      if (refusal) return refusal;
      await require_workspace_environment(context).write?.(workspace_path, input.content);
      return ok_text(
        `Wrote ${absolute_workspace_path(workspace_path)}`,
        produced_file_metadata(workspace_path, workspace_written_in(context)),
      );
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-edit_file',
    description: 'Replace text in a sandbox file.',
    input_schema: object_schema(
      {
        path: workspace_path_schema('Sandbox file path to edit.'),
        old_text: string_schema('Existing text to replace.'),
        new_text: string_schema('Replacement text.'),
        replace_all: boolean_schema('Whether to replace every occurrence.'),
      },
      ['path', 'old_text', 'new_text'],
    ),
    validate_input: workspace_edit_file_input_schema,
    policy: workspace_policy('write'),
    approval_display_fields: ['path', 'old_text', 'new_text'],
    execute: async (input, context) => {
      const workspace_path = canonical_workspace_file_path(input.path);
      const refusal = reserved_path_refusal(workspace_path, workspace_layout_in(context));
      if (refusal) return refusal;
      const result = await require_workspace_environment(context).edit?.({
        path: workspace_path,
        old_text: input.old_text,
        new_text: input.new_text,
        replace_all: input.replace_all ?? false,
      });
      if (!result || result.replacements === 0) {
        return err(
          'edit_matched_nothing',
          `No occurrence of that old_text is in ${workspace_path}, so the file is unchanged. Read it and match its text exactly, whitespace and all.`,
          produced_file_metadata(workspace_path, workspace_written_in(context)),
        );
      }
      return ok_json(result, produced_file_metadata(workspace_path, workspace_written_in(context)));
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-grep',
    description: 'Search sandbox files for a regular expression.',
    input_schema: object_schema(
      {
        pattern: string_schema('Regular expression to search for.'),
        path: workspace_path_schema('Sandbox path to search. Defaults to sandbox root.'),
        case_sensitive: boolean_schema('Whether matching is case-sensitive.'),
        max_results: number_schema('Maximum result count.'),
      },
      ['pattern'],
    ),
    validate_input: workspace_grep_input_schema,
    policy: workspace_policy('read'),
    execute: async (input, context) => {
      const max_results = input.max_results;
      const matches = await require_workspace_environment(context).grep?.({
        pattern: input.pattern,
        path: canonical_workspace_file_path(input.path ?? '.'),
        case_sensitive: input.case_sensitive ?? true,
        ...(max_results === undefined ? {} : { max_results }),
      });
      return ok_json(matches ?? []);
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-glob',
    description: 'Find sandbox paths matching a glob pattern.',
    input_schema: object_schema(
      {
        pattern: string_schema('Glob pattern to match.'),
        max_results: number_schema('Maximum result count.'),
      },
      ['pattern'],
    ),
    validate_input: workspace_glob_input_schema,
    policy: workspace_policy('read'),
    execute: async (input, context) => {
      const max_results = input.max_results;
      const paths = await require_workspace_environment(context).glob?.({
        pattern: canonical_workspace_glob_pattern(input.pattern),
        ...(max_results === undefined ? {} : { max_results }),
      });
      return ok_json(paths ?? []);
    },
  }),
  define_workspace_tool({
    tool_name: 'workspace-run_command',
    description:
      'Run a command inside the sandbox and wait for it to finish. The default timeout is ' +
      '120000ms (2 minutes); pass timeout_ms up to 600000 (10 minutes) for slow work — ' +
      'npm install, a production build, or anything touching the durable disk regularly ' +
      'needs several minutes, so give it the time up front instead of retrying at 2 minutes. ' +
      'Anything that runs longer than 10 minutes, or never exits on its own (servers, ' +
      'watchers, queue workers), belongs in workspace-start_background_command — or in ' +
      'workspace-preview when it is an HTTP server the user should get a link to.',
    input_schema: object_schema(
      {
        command: {
          type: 'string',
          description:
            'Executable to run, or a whole shell line when args is omitted (pipes and redirects work).',
          examples: ['npm', 'bash', 'grep -c error logs/build.log | head -1'],
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for command. Omit when command is a shell line.',
          examples: [
            ['install', '--no-audit'],
            ['-lc', 'ls -la artifacts'],
          ],
        },
        cwd: workspace_path_schema(
          `Workspace cwd. Defaults to the workspace root ${workspace_root}.`,
        ),
        writable_paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Existing persistent files or directories this command will modify. Declare the parent directory for rename, delete, or atomic file replacement.',
        },
        timeout_ms: number_schema(
          'Command timeout in milliseconds. Defaults to 120000, maximum 600000 (10 minutes).',
        ),
      },
      ['command'],
    ),
    validate_input: workspace_command_input_schema,
    policy: workspace_policy('exec'),
    approval_display_fields: ['command', 'args'],
    policy_timeout_ms: (input) => workspace_command_timeout_ms(input) + policy_timeout_grace_ms,
    execute: execute_workspace_command,
  }),
  define_workspace_tool({
    tool_name: 'workspace-start_background_command',
    description:
      'Start a command in the sandbox and get its id back immediately, without waiting for ' +
      "it to finish. Use it for work that outlasts workspace-run_command's 10 minute " +
      'ceiling, and for anything that never exits on its own: long installs, watchers, ' +
      'queue workers, training or scraping scripts. Then keep working and call ' +
      'workspace-check_background_command for its status and output — with wait_seconds when ' +
      'you have nothing else to do but wait for it. Use workspace-preview instead for an HTTP ' +
      'server the user should get a preview link to. The job runs until it exits, until you ' +
      'stop it, or until this sandbox ends — it does not survive into a later session. It can ' +
      'create new files on the durable disk, but to overwrite or delete existing ones use ' +
      'workspace-run_command with writable_paths.',
    input_schema: object_schema(
      {
        command: string_schema('Executable to run, for example npm.'),
        args: { type: 'array', items: { type: 'string' } },
        cwd: workspace_path_schema(
          `Workspace cwd. Defaults to the workspace root ${workspace_root}.`,
        ),
      },
      ['command'],
    ),
    validate_input: workspace_start_background_command_input_schema,
    policy: workspace_policy('exec'),
    approval_display_fields: ['command', 'args'],
    execute: execute_workspace_start_background_command,
  }),
  define_workspace_tool({
    tool_name: 'workspace-check_background_command',
    description:
      'Check a background command started with workspace-start_background_command: whether it ' +
      'is still running or has exited, its exit code, and the tail of its output. Set ' +
      'wait_seconds (up to 120) to wait for it to finish instead of polling — the call ' +
      'returns the moment the command exits, or when the wait runs out with the command ' +
      'still running, and you can simply call it again.',
    input_schema: object_schema(
      {
        background_command_id: string_schema('Id returned by workspace-start_background_command.'),
        wait_seconds: number_schema(
          'Seconds to wait for the command to exit before answering. Defaults to 0 (answer now), maximum 120.',
        ),
      },
      ['background_command_id'],
    ),
    validate_input: workspace_check_background_command_input_schema,
    policy: workspace_policy('exec'),
    policy_timeout_ms: (input) => background_command_wait_ms(input) + exec_policy_timeout_ms,
    execute: execute_workspace_check_background_command,
  }),
  define_workspace_tool({
    tool_name: 'workspace-stop_background_command',
    description:
      'Stop a background command started with workspace-start_background_command, killing it ' +
      'and its child processes. Use it when a job is stuck, is no longer needed, or when you ' +
      'have hit the limit of concurrent background commands.',
    input_schema: object_schema(
      {
        background_command_id: string_schema('Id returned by workspace-start_background_command.'),
      },
      ['background_command_id'],
    ),
    validate_input: workspace_stop_background_command_input_schema,
    policy: workspace_policy('exec'),
    execute: execute_workspace_stop_background_command,
  }),
  define_workspace_tool({
    tool_name: 'workspace-preview',
    description:
      'Start a long-running HTTP server in the sandbox and return a preview URL. ALWAYS finish a build by calling this so the user gets a working preview link — do not stop after only writing files. Use this instead of workspace-run_command for anything that serves HTTP (it keeps the process alive). For a static site or plain HTML/CSS/JS, serve the files, for example command "npx" args ["-y","serve","-l","3000","."] or command "python3" args ["-m","http.server","3000"]. For Next.js, run npm run build first and preview npm run start. For Vite or similar dev servers, preview the dev server command. The server must listen on 0.0.0.0 and on the given port.',
    input_schema: object_schema(
      {
        command: string_schema('Executable to run, for example npm.'),
        args: { type: 'array', items: { type: 'string' } },
        cwd: workspace_path_schema(
          `Workspace cwd. Defaults to the workspace root ${workspace_root}.`,
        ),
        port: number_schema('HTTP port exposed by the dev server. Defaults to 3000.'),
        ready_path: string_schema('HTTP path to poll before returning. Defaults to /.'),
        timeout_ms: number_schema('Maximum time to wait for the server to become ready.'),
      },
      ['command'],
    ),
    validate_input: workspace_preview_input_schema,
    policy: workspace_policy('exec'),
    approval_display_fields: ['command', 'args'],
    execute: execute_workspace_preview,
  }),
  define_workspace_tool({
    tool_name: 'workspace-http_request',
    description:
      'Make an HTTP request from inside the sandbox. Requests to a connected app host are ' +
      'authenticated automatically on the way out — never add Authorization or Cookie headers, ' +
      'and never ask anyone for a credential. Use this for any API that has no catalog tool: ' +
      'call the vendor endpoint directly instead of driving the browser or writing a client. ' +
      'Returns the status line, response headers of interest, and the body.',
    input_schema: object_schema(
      {
        method: string_schema('HTTP method: GET, HEAD, POST, PUT, PATCH or DELETE.'),
        url: string_schema('Absolute http(s) URL to request.'),
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Request headers, e.g. Accept or Content-Type. Credential headers are rejected — ' +
            'the platform attaches them at the network edge.',
        },
        body: string_schema('Request body for POST/PUT/PATCH, sent as-is.'),
        timeout_ms: number_schema('Request timeout in milliseconds. Defaults to 30000.'),
      },
      ['method', 'url'],
    ),
    validate_input: workspace_http_request_input_schema,
    approval_display_fields: ['method', 'url', 'body'],
    policy: workspace_policy('exec'),
    execute: execute_workspace_http_request,
  }),
];

const legacy_sandbox_aliases = [
  ['sandbox-list', 'workspace-list_files'],
  ['sandbox-read', 'workspace-read_file'],
  ['sandbox-view_image', 'workspace-view_image'],
  ['sandbox-write', 'workspace-write_file'],
  ['sandbox-edit', 'workspace-edit_file'],
  ['sandbox-grep', 'workspace-grep'],
  ['sandbox-glob', 'workspace-glob'],
  ['sandbox-exec', 'workspace-run_command'],
  ['sandbox-preview', 'workspace-preview'],
] as const;

const workspace_tools: WorkspaceToolDefinition[] = [
  ...workspace_file_tools,
  ...legacy_sandbox_aliases.map(([legacy_name, canonical_name]) =>
    workspace_tool_alias(legacy_name, canonical_name),
  ),
];

export function find_workspace_tool(tool_name: string): WorkspaceToolDefinition | undefined {
  return workspace_tools.find((tool) => tool.tool_name === tool_name);
}

function workspace_tool_alias(
  legacy_name: string,
  canonical_name: string,
): WorkspaceToolDefinition {
  const canonical_tool = workspace_file_tools.find((tool) => tool.tool_name === canonical_name);
  if (!canonical_tool) throw new Error(`Unknown workspace tool alias target: ${canonical_name}`);
  return {
    ...canonical_tool,
    tool_name: legacy_name,
    description: `${canonical_tool.description} Legacy alias for ${canonical_name}.`,
  };
}

async function run_workspace_tool_with_policy(
  tool: WorkspaceToolDefinition,
  input: unknown,
  context: RuntimeToolContext,
) {
  if (tool.policy.approval_mode === 'block') {
    return err('blocked_by_policy', `${tool.tool_name} is blocked by policy.`);
  }
  if (tool.policy.sandbox_required && !context.environment) {
    return err('sandbox_unavailable', `${tool.tool_name} requires a workspace sandbox.`);
  }

  try {
    const parsed_input = tool.validate_input ? tool.validate_input.parse(input) : input;
    return await run_with_timeout(
      workspace_tool_timeout_ms(tool, parsed_input),
      context.signal,
      (signal) => tool.execute(parsed_input, { ...context, signal }),
    );
  } catch (error) {
    if (error instanceof PolicyTimeoutError) {
      return err('timed_out', `${tool.tool_name} exceeded policy.timeout_ms=${error.timeout_ms}`);
    }
    return err(canonical_workspace_error_code(error), format_error_message(error));
  }
}

export function workspace_tool_timeout_ms(tool: WorkspaceToolDefinition, parsed_input: unknown) {
  return tool.policy_timeout_ms?.(parsed_input) ?? tool.policy.timeout_ms;
}

const default_workspace_command_timeout_ms = 120_000;
const max_workspace_command_timeout_ms = 600_000;
const policy_timeout_grace_ms = 10_000;

function workspace_command_timeout_ms(input: { timeout_ms?: number | undefined }) {
  const requested_ms = input.timeout_ms ?? default_workspace_command_timeout_ms;
  if (!Number.isFinite(requested_ms) || requested_ms <= 0) {
    return default_workspace_command_timeout_ms;
  }
  return Math.min(requested_ms, max_workspace_command_timeout_ms);
}

async function execute_workspace_command(
  input: z.infer<typeof workspace_command_input_schema>,
  context: RuntimeToolContext,
) {
  const environment = require_workspace_environment(context);
  const timeout_ms = workspace_command_timeout_ms(input);
  const writable_paths = input.writable_paths ?? [];
  const { command, args } = normalize_shell_line_command(input.command, input.args ?? []);
  const long_running_message = unsupported_long_running_command_message(command, args);
  if (long_running_message) {
    return err('blocked_by_policy', long_running_message, {
      reason: 'long_running_process_unsupported',
    });
  }

  const started_at = Date.now();
  const result = await environment.exec?.({
    command,
    args,
    cwd: canonical_shell_working_directory(input.cwd),
    writable_paths,
    timeout_ms,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });

  if (!result) return err('sandbox_unavailable', 'Workspace command execution is unavailable.');
  const text = command_result_text(result);
  const metadata = { command_result: result, command_started_at_ms: started_at };
  if (result.timed_out) {
    const remedies = with_longer_run_remedies(text, Date.now() - started_at, timeout_ms);
    return err('timed_out', remedies, metadata);
  }
  if (result.exit_code !== 0) {
    return err('command_failed', with_read_only_remedy(text, writable_paths), metadata);
  }
  return ok_text(text, metadata);
}

function normalize_shell_line_command(command: string, args: readonly string[]) {
  if (args.length > 0) return { command, args: [...args] };
  if (!/[\s|&;><*?"'`$(]/u.test(command.trim())) return { command, args: [...args] };
  return { command: 'bash', args: ['-lc', command] };
}

function with_longer_run_remedies(text: string, elapsed_ms: number, timeout_ms: number) {
  return [
    text,
    `The command ran for ${Math.round(elapsed_ms / 1000)}s and was stopped at its ${Math.round(
      timeout_ms / 1000,
    )}s timeout. It was not finished, so nothing about it failed except the time it was given.`,
    `If it just needs longer, re-run it with a bigger timeout_ms (up to ${max_workspace_command_timeout_ms}, ten minutes) — installs and builds on the durable disk routinely need several minutes.`,
    'If it needs more than ten minutes, or never exits on its own, start it with workspace-start_background_command and come back to it with workspace-check_background_command. Use workspace-preview instead for an HTTP server you want a preview URL for.',
  ].join('\n\n');
}

function with_read_only_remedy(text: string, writable_paths: string[]) {
  if (!text.includes('Read-only file system')) return text;
  const declared = writable_paths.length > 0 ? ` (declared: ${writable_paths.join(', ')})` : '';
  return `${text}\n\nThe path is on the shared durable disk. Re-run this command with writable_paths set to the parent directory of every file it deletes, renames, or overwrites${declared}.`;
}

const max_background_commands_per_session = 5;
const max_background_command_wait_seconds = 120;

function background_command_wait_ms(input: { wait_seconds?: number | undefined }) {
  const wait_seconds = input.wait_seconds ?? 0;
  if (!Number.isFinite(wait_seconds) || wait_seconds <= 0) return 0;
  return Math.min(wait_seconds, max_background_command_wait_seconds) * 1000;
}

function background_commands_unsupported() {
  return err(
    'background_commands_unsupported',
    'This workspace sandbox does not support background commands. Run the command with ' +
      'workspace-run_command and a larger timeout_ms (up to 10 minutes) instead.',
  );
}

async function execute_workspace_start_background_command(
  input: z.infer<typeof workspace_start_background_command_input_schema>,
  context: RuntimeToolContext,
) {
  const environment = require_workspace_environment(context);
  if (!environment.start_background_command || !environment.list_background_commands) {
    return background_commands_unsupported();
  }

  const running = (await environment.list_background_commands()).filter(
    (background_command) => background_command.status === 'running',
  );
  if (running.length >= max_background_commands_per_session) {
    return err(
      'too_many_background_commands',
      `${running.length} background commands are already running (the limit is ${max_background_commands_per_session}): ${running
        .map((background_command) => background_command.background_command_id)
        .join(
          ', ',
        )}. Stop one with workspace-stop_background_command, or wait for it with workspace-check_background_command.`,
    );
  }

  const status = await environment.start_background_command({
    command: input.command,
    args: input.args ?? [],
    cwd: canonical_shell_working_directory(input.cwd),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
  return ok_json(background_command_view(status), {
    background_command_id: status.background_command_id,
  });
}

async function execute_workspace_check_background_command(
  input: z.infer<typeof workspace_check_background_command_input_schema>,
  context: RuntimeToolContext,
) {
  const environment = require_workspace_environment(context);
  if (!environment.check_background_command) return background_commands_unsupported();

  const status = await environment.check_background_command({
    background_command_id: input.background_command_id,
    wait_seconds: background_command_wait_ms(input) / 1000,
  });
  if (!status) return background_command_not_found(input.background_command_id);
  return ok_json(background_command_view(status), {
    background_command_id: status.background_command_id,
  });
}

async function execute_workspace_stop_background_command(
  input: z.infer<typeof workspace_stop_background_command_input_schema>,
  context: RuntimeToolContext,
) {
  const environment = require_workspace_environment(context);
  if (!environment.stop_background_command) return background_commands_unsupported();

  const status = await environment.stop_background_command({
    background_command_id: input.background_command_id,
  });
  if (!status) return background_command_not_found(input.background_command_id);
  return ok_json({ ...background_command_view(status), status: 'stopped' });
}

function background_command_not_found(background_command_id: string) {
  return err(
    'background_command_not_found',
    `No background command ${background_command_id} is being tracked. It was stopped, or it ` +
      'was started in an earlier session — background commands live only as long as the ' +
      'sandbox that started them. Start it again with workspace-start_background_command.',
  );
}

function background_command_view(status: SessionEnvBackgroundCommandStatus) {
  return {
    background_command_id: status.background_command_id,
    status: status.status,
    ...(status.exit_code === undefined ? {} : { exit_code: status.exit_code }),
    command: status.command,
    cwd: status.cwd,
    started_time: status.started_time,
    stdout: status.stdout,
    stderr: status.stderr,
  };
}

export async function start_static_preview_if_absent(db: Database, input: StaticPreviewInput) {
  const runtime_environment = await find_static_preview_target(db, input);
  if (!runtime_environment) return;
  try {
    await start_static_preview(db, input, runtime_environment);
  } catch {}
}

async function limit_workspace_tool_output(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    runtime_environment_id?: string;
    source_tool_call_id: string;
    actor_id: string;
    context: RuntimeToolContext;
    result: RuntimeToolResult;
  },
): Promise<{ result: RuntimeToolResult; output_file_id?: string }> {
  const text = runtime_tool_result_text(input.result);
  if (Buffer.byteLength(text, 'utf8') <= default_output_limit_bytes) {
    return { result: input.result };
  }

  const output_path = tool_output_path(input.context, `${input.source_tool_call_id}.txt`);
  await input.context.environment?.write?.(output_path, text);
  const output_artifact = await create_workspace_artifact(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.runtime_environment_id === undefined
      ? {}
      : { runtime_environment_id: input.runtime_environment_id }),
    source_tool_call_id: input.source_tool_call_id,
    actor_id: input.actor_id,
    context: input.context,
    workspace_path: output_path,
    file_purpose: 'tool_output',
    is_visible: false,
    file_metadata: { reason: 'output_truncated' },
  });
  const truncated_text = `${cap_model_visible_tool_text(text)}\n[full output saved to ${output_path} — read it with workspace-read_file]`;
  const metadata = {
    ...input.result.metadata,
    full_output_path: output_path,
    output_file_id: output_artifact?.file_id,
    truncated: true,
  };
  return {
    result: input.result.ok
      ? ok_text(truncated_text, metadata)
      : err(input.result.error_code, truncated_text, metadata),
    ...(output_artifact === undefined ? {} : { output_file_id: output_artifact.file_id }),
  };
}

async function spill_oversized_catalog_tool_result(
  db: Database,
  input: ExecuteRuntimeToolInput,
  tool_call: ToolCall,
  result: SuccessfulPlatformToolResult,
): Promise<SuccessfulPlatformToolResult> {
  try {
    const full_text = JSON.stringify(
      project_model_visible_tool_payload(result.model_visible_data ?? result.data),
    );
    if (full_text === undefined || full_text.length <= model_visible_tool_text_limit_chars) {
      return result;
    }
    const environment = input.environment;
    if (!environment?.write) return result;

    const tool_context = { run_key: input.run_id, metadata: input.tool_context_metadata ?? {} };
    const full_output_path = tool_output_path(tool_context, `${tool_call.tool_call_id}.json`);
    await environment.write(full_output_path, full_text);
    const output_artifact = await create_workspace_artifact(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      source_tool_call_id: tool_call.tool_call_id,
      actor_id: input.actor_id,
      context: { ...tool_context, session_key: input.session_id, environment },
      workspace_path: full_output_path,
      file_purpose: 'tool_output',
      is_visible: false,
      file_metadata: { reason: 'model_visible_overflow' },
    });
    return {
      ...result,
      model_visible_data: spilled_result_receipt(full_output_path, full_text),
      metadata: {
        ...result.metadata,
        full_output_path,
        ...(output_artifact ? { output_file_id: output_artifact.file_id } : {}),
      },
    };
  } catch (error) {
    log.warn('Could not save the oversized tool result to the workspace.', {
      tool_call_id: tool_call.tool_call_id,
      node_key: input.node_key,
      error: format_error_message(error),
    });
    return result;
  }
}

function spilled_result_receipt(full_output_path: string, full_text: string) {
  return {
    saved_to: full_output_path,
    total_characters: full_text.length,
    preview: full_text.slice(0, 12_000),
    preview_tail: full_text.slice(-1_500),
    note: `Result too large to show in full. The complete JSON is saved at ${full_output_path} — read it with workspace-read_file or open it from code in the sandbox.`,
  };
}

async function create_produced_workspace_artifact(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    runtime_environment_id?: string;
    source_tool_call_id: string;
    actor_id: string;
    context: RuntimeToolContext;
    result: RuntimeToolResult;
  },
) {
  const metadata = input.result.metadata;
  const command_started_at_ms = metadata?.command_started_at_ms;
  if (typeof command_started_at_ms === 'number') {
    const command = { ...input, environment: input.context.environment, command_started_at_ms };
    await defer_run_write(input.run_id, 'files a command wrote', () =>
      record_files_a_command_wrote(db, command),
    );
  }
  const workspace_path =
    typeof metadata?.produced_workspace_path === 'string'
      ? metadata.produced_workspace_path
      : undefined;
  const file_purpose =
    typeof metadata?.produced_artifact_kind === 'string'
      ? metadata.produced_artifact_kind
      : undefined;

  if (!input.result.ok || !workspace_path || !file_purpose) return undefined;

  return create_workspace_artifact(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    ...(input.runtime_environment_id === undefined
      ? {}
      : { runtime_environment_id: input.runtime_environment_id }),
    source_tool_call_id: input.source_tool_call_id,
    actor_id: input.actor_id,
    context: input.context,
    workspace_path,
    file_purpose,
    is_visible: true,
    file_metadata: { source: 'workspace_tool' },
  });
}

async function create_workspace_artifact(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    runtime_environment_id?: string;
    source_tool_call_id: string;
    actor_id: string;
    context: RuntimeToolContext;
    workspace_path: string;
    file_purpose: string;
    is_visible: boolean;
    file_metadata?: Record<string, unknown>;
  },
) {
  const env = input.context.environment;
  if (!env) return undefined;
  const bytes = await read_artifact_bytes(env, input.workspace_path);
  if (bytes === undefined) return undefined;
  const file_name = path.posix.basename(input.workspace_path);
  const mime_type = mime_type_for_artifact(input.file_purpose, file_name);
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return create_file(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    runtime_environment_id: input.runtime_environment_id ?? null,
    source_tool_call_id: input.source_tool_call_id,
    file_purpose: input.file_purpose,
    file_status: 'ready',
    ...(await storage_for_workspace_file({ ...input, data: bytes, content_type: mime_type })),
    workspace_path: input.workspace_path,
    file_name,
    mime_type,
    byte_size: bytes.byteLength,
    checksum_sha256: createHash('sha256').update(buffer).digest('hex'),
    content_preview: text_preview_from_bytes(bytes, mime_type),
    is_visible: input.is_visible,
    ...(input.file_metadata === undefined ? {} : { file_metadata: input.file_metadata }),
    actor_id: input.actor_id,
  });
}

async function read_artifact_bytes(
  env: NonNullable<RuntimeToolContext['environment']>,
  workspace_path: string,
): Promise<Uint8Array | undefined> {
  if (env.read_bytes) return env.read_bytes(workspace_path);
  const text = await env.read?.(workspace_path);
  if (text === undefined) return undefined;
  return new TextEncoder().encode(text);
}

function mime_type_for_artifact(file_purpose: string, file_name: string): string {
  if (file_purpose === 'screenshot') {
    if (file_name.endsWith('.png')) return 'image/png';
    if (file_name.endsWith('.jpg') || file_name.endsWith('.jpeg')) return 'image/jpeg';
    if (file_name.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }
  if (file_purpose === 'download') return 'application/octet-stream';
  if (file_purpose === 'log') return 'text/plain; charset=utf-8';
  if (file_purpose === 'tool_output') return 'text/plain; charset=utf-8';
  return mime_type_for_file_name(file_name, 'text/plain; charset=utf-8');
}

function text_preview_from_bytes(bytes: Uint8Array, mime_type: string): string {
  if (!mime_type.startsWith('text/') && mime_type !== 'application/json') return '';
  const slice = bytes.subarray(0, 1000);
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch {
    return '';
  }
}

function workspace_policy(risk_class: RuntimeToolPolicy['risk_class']): RuntimeToolPolicy {
  return {
    timeout_ms: risk_class === 'exec' ? exec_policy_timeout_ms : 30_000,
    output_limit_bytes: default_output_limit_bytes,
    risk_class,
    approval_mode: 'auto',
    sandbox_required: true,
  };
}

function workspace_path_schema(description: string): RuntimeJsonSchema {
  return {
    type: 'string',
    description: `${description} ${workspace_path_rule}`,
    examples: workspace_path_examples,
  };
}

function unsupported_long_running_command_message(command: string, args: string[]) {
  const script = command_script(command, args);
  if (!script) return undefined;

  if (
    /\bnohup\b/u.test(script) ||
    /(^|\s)&\s*(?:[;|)]|$)/u.test(script) ||
    /\bnext\s+start\b/u.test(script) ||
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?start\b/u.test(script) ||
    /\bvite\b.*\b--host\b/u.test(script) ||
    /\b(?:uvicorn|gunicorn|fastapi|flask)\b/u.test(script)
  ) {
    return [
      'workspace-run_command runs a command to completion and waits for it, so it cannot host a process that stays up.',
      'For an HTTP server the user should get a link to, use workspace-preview (for Next.js, run npm run build first and preview npm run start).',
      'For anything else that keeps running — watchers, queue workers, long installs — use workspace-start_background_command, then workspace-check_background_command to see how it is doing.',
    ].join(' ');
  }

  return undefined;
}

function command_script(command: string, args: string[]) {
  if (['sh', 'bash', 'zsh'].includes(path.posix.basename(command))) {
    const script_flag_index = args.findIndex((arg) => arg === '-c' || /^-[a-zA-Z]*c/u.test(arg));
    return script_flag_index === -1 ? args.join(' ') : (args[script_flag_index + 1] ?? '');
  }

  return [command, ...args].join(' ');
}

const max_viewable_image_bytes = 25 * 1024 * 1024;

const max_convertible_document_bytes = 25 * 1024 * 1024;

async function convert_document_to_markdown(
  bytes: Uint8Array,
  workspace_path: string,
): Promise<RuntimeToolResult> {
  const anydoc = await import('@firecrawl/anydoc');
  const buffer = Buffer.from(bytes);
  const detected = anydoc.formatFromBytes(buffer) ?? anydoc.formatFromPath(workspace_path);
  if (detected === null) {
    return err(
      'not_a_document',
      `${workspace_path} is not a recognized document format. Supported: Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV, PDF. For plain text, use workspace-read_file.`,
    );
  }

  try {
    const markdown = await anydoc.toMarkdownBytes(buffer, detected);
    if (markdown.trim() === '') {
      return ok_text(
        `[${workspace_path} converted to empty Markdown — for a PDF this usually means scanned pages with no text layer, which need OCR this tool does not do.]`,
        { workspace_path, document_format: String(detected) },
      );
    }
    return ok_text(markdown, { workspace_path, document_format: String(detected) });
  } catch (error) {
    return err(
      'document_conversion_failed',
      `Converting ${workspace_path} failed: ${format_error_message(error)}. The file may be corrupt or password-protected.`,
    );
  }
}

const image_mime_types_by_extension: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function image_mime_type_for_path(workspace_path: string): string | undefined {
  return image_mime_types_by_extension[path.posix.extname(workspace_path).toLowerCase()];
}

function workspace_error_status(error_code: string) {
  if (error_code === 'timed_out') return 'timed_out' as const;
  if (error_code === stopped_tool_error_code) return 'cancelled' as const;
  if (error_code === 'blocked_by_policy' || error_code === 'approval_required') {
    return 'blocked' as const;
  }
  if (error_code === 'repeat_declined') return 'denied' as const;
  return 'failed' as const;
}

function canonical_workspace_error_code(error: unknown) {
  const message = format_error_message(error);
  if (message.includes('timed out')) return 'timed_out';
  if (message.includes('Symlink escapes workspace')) return 'symlink_escape';
  if (message.includes('Path escapes workspace')) return 'path_escape';
  if (message.includes('sandbox_unavailable')) return 'sandbox_unavailable';
  if (message.includes('Invalid')) return 'invalid_input';
  return 'upstream_error';
}
