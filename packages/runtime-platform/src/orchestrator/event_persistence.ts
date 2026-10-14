import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import type {
  RuntimeAgentMessage,
  RuntimeAgentMessagePart,
} from '@agent-core/messages/runtime_message';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { Database } from '@coworker/core';
import {
  create_run_message,
  create_usage_record,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import type { MessageContent, MessageContentPart } from '@coworker/shared';
import { run_failure_sentence_on_this_install } from '@runtime-platform/orchestrator/run_failure_sentence';
import { runtime_parts_to_message_content } from '@runtime-platform/orchestrator/runtime_message_content';
import { create_stored_run_event } from '@runtime-platform/orchestrator/stored_run_event_payloads';
import { metadata_to_store_for_runtime_event } from '@runtime-platform/orchestrator/stored_runtime_tool_events';

export async function record_runtime_message(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    role: 'assistant' | 'tool_result' | 'event';
    content: MessageContent;
    source_metadata?: Record<string, unknown>;
    is_user_visible?: boolean;
    is_model_visible?: boolean;
    actor_id: string;
  },
) {
  const source_metadata: Record<string, unknown> =
    input.content.type === 'reasoning_summary'
      ? { visibility: 'debug_trace', ...(input.source_metadata ?? {}) }
      : { ...tool_result_source_metadata(input.content), ...(input.source_metadata ?? {}) };
  const content_is_user_visible =
    input.content.type !== 'reasoning_summary' && source_metadata.has_visible_text !== false;
  const is_user_visible = input.is_user_visible === false ? false : content_is_user_visible;
  const message = await create_run_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    message_role: input.role,
    message_content: input.content,
    ...tool_result_message_reference(input.role, input.content),
    is_user_visible,
    is_model_visible: input.is_model_visible ?? input.content.type !== 'reasoning_summary',
    source_metadata,
    source_type: input.role === 'tool_result' ? 'tool' : 'runtime',
    actor_id: input.actor_id,
  });

  await create_usage_record(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    usage_kind: 'message',
    quantity: '1',
    unit: 'message',
    actor_id: input.actor_id,
  });

  return message;
}

function read_tool_call_id(content: MessageContent) {
  const tool_result_part = content.parts?.find((part) => part.type === 'tool_result');
  if (tool_result_part?.type === 'tool_result') return tool_result_part.tool_call_id;

  const data_tool_call_id = content.data?.tool_call_id;
  return typeof data_tool_call_id === 'string' ? data_tool_call_id : undefined;
}

function tool_result_message_reference(role: string, content: MessageContent) {
  if (role !== 'tool_result') return {};

  const tool_call_id = read_tool_call_id(content);
  return tool_call_id ? { tool_call_id } : {};
}

function tool_result_source_metadata(content: MessageContent): Record<string, unknown> {
  if (content.type !== 'tool_result') return {};

  const tool_result_part = content.parts?.find((part) => part.type === 'tool_result');
  if (tool_result_part?.type === 'tool_result' && tool_result_part.tool_name) {
    return { tool_name: tool_result_part.tool_name };
  }

  const data_tool_name = content.data?.tool_name;
  return typeof data_tool_name === 'string' ? { tool_name: data_tool_name } : {};
}

export async function record_runtime_event(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    event: RuntimeRunEvent;
    is_user_visible?: boolean;
    actor_id: string;
  },
) {
  if (input.event.event_type === 'message_delta') return undefined;
  if (should_skip_persisting_progress_event(input.event)) return undefined;

  const event_label = runtime_event_label(input.event);
  await create_stored_run_event(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    event_type: input.event.event_type,
    event_label,
    event_data: runtime_event_data(input.event),
    event_metadata: await metadata_to_store_for_runtime_event(db, {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      event_label,
      metadata: runtime_event_metadata(input.event),
    }),
    actor_id: input.actor_id,
  });

  if (input.event.event_type === 'message') {
    return record_runtime_message(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      role: 'assistant',
      content: runtime_message_to_content(input.event.message),
      source_metadata: runtime_message_source_metadata(input.event.message),
      ...(input.is_user_visible === undefined ? {} : { is_user_visible: input.is_user_visible }),
      actor_id: input.actor_id,
    });
  }

  if (input.event.event_type === 'error') {
    return record_runtime_failure_message(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      text: runtime_failure_text_for(input.event.error),
      ...(input.is_user_visible === undefined ? {} : { is_user_visible: input.is_user_visible }),
      actor_id: input.actor_id,
    });
  }

  return undefined;
}

const self_describing_failure_codes = new Set(['out_of_credits']);

function runtime_failure_text_for(error: { code: string; message: string }) {
  if (self_describing_failure_codes.has(error.code)) return error.message;
  return run_failure_sentence_on_this_install({ message: error.message });
}

export function record_runtime_failure_message(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    text: string;
    is_user_visible?: boolean;
    actor_id: string;
  },
) {
  return record_runtime_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    role: 'assistant',
    content: { type: 'text', text: input.text },
    is_model_visible: false,
    ...(input.is_user_visible === undefined ? {} : { is_user_visible: input.is_user_visible }),
    actor_id: input.actor_id,
  });
}

export async function mark_run_running(db: Database, run_id: string, actor_id: string) {
  return update_run_status(db, { run_id, run_status: 'running', actor_id });
}

export async function mark_run_completed(db: Database, run_id: string, actor_id: string) {
  return update_run_status(db, {
    run_id,
    run_status: 'completed',
    actor_id,
    current_run_statuses: ['running'],
  });
}

export async function mark_run_cancelled(db: Database, run_id: string, actor_id: string) {
  return update_run_status(db, {
    run_id,
    run_status: 'cancelled',
    actor_id,
    current_run_statuses: ['queued', 'starting', 'running', 'waiting'],
  });
}

export async function mark_run_failed(
  db: Database,
  run_id: string,
  actor_id: string,
  error_message: string,
  error_code?: string,
) {
  return update_run_status(db, {
    run_id,
    run_status: 'failed',
    actor_id,
    error_message,
    ...(error_code === undefined ? {} : { error_code }),
    current_run_statuses: ['queued', 'starting', 'running', 'waiting'],
  });
}

function runtime_message_to_content(message: RuntimeAgentMessage): MessageContent {
  const parts = runtime_parts_to_message_content(message.content).parts ?? [];
  const has_multimodal_part = parts.some(is_multimodal_content_part);
  const has_visible_part = message.content.some(is_turn_content_part);
  const has_reasoning_text = message.content.some(is_nonempty_thinking_part);
  const has_only_internal_reasoning = !has_visible_part && has_reasoning_text;
  const text = has_only_internal_reasoning
    ? reasoning_parts_text(message.content)
    : visible_parts_text(message.content);

  return {
    type: has_only_internal_reasoning
      ? 'reasoning_summary'
      : has_multimodal_part
        ? 'multimodal'
        : 'text',
    ...(text ? { text } : {}),
    ...(parts.length === 0 ? {} : { parts }),
  };
}

function runtime_message_source_metadata(message: RuntimeAgentMessage) {
  return {
    has_visible_text: message.content.some(is_visible_message_part),
    ...(message.name === undefined ? {} : { name: message.name }),
    ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
    ...(message.metadata === undefined ? {} : { provider_metadata: message.metadata }),
  };
}

function is_multimodal_content_part(part: MessageContentPart) {
  return part.type === 'image' || part.type === 'file';
}

function visible_parts_text(parts: readonly RuntimeAgentMessagePart[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'json') return JSON.stringify(part.json);
      if (part.type === 'file') return part.text ?? part.name ?? part.path ?? part.url ?? '';
      if (part.type === 'tool_result') return runtime_tool_result_text(part.result);
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function reasoning_parts_text(parts: readonly RuntimeAgentMessagePart[]) {
  return parts
    .map((part) => (part.type === 'thinking' && !part.redacted ? part.thinking : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function is_visible_message_part(part: RuntimeAgentMessagePart) {
  if (part.type === 'text') return Boolean(part.text.trim());
  if (part.type === 'file') return true;
  if (part.type === 'image') return true;
  if (part.type === 'tool_result') return true;
  return false;
}

function is_turn_content_part(part: RuntimeAgentMessagePart) {
  return is_visible_message_part(part) || part.type === 'tool_call';
}

function is_nonempty_thinking_part(part: RuntimeAgentMessagePart) {
  return part.type === 'thinking' && !part.redacted && Boolean(part.thinking.trim());
}

function runtime_tool_result_text(result: RuntimeToolResult) {
  if (!result.ok) return result.error_message;
  if (result.content_text) return result.content_text;
  return JSON.stringify(result.content_json ?? result.metadata ?? {});
}

function runtime_event_data(event: Exclude<RuntimeRunEvent, { event_type: 'message_delta' }>) {
  if (!('metadata' in event)) return event;

  const { metadata: _metadata, ...event_data } = event;
  return event_data;
}

function runtime_event_metadata(event: Exclude<RuntimeRunEvent, { event_type: 'message_delta' }>) {
  return 'metadata' in event && typeof event.metadata === 'object' && event.metadata !== null
    ? event.metadata
    : {};
}

function runtime_event_label(event: Exclude<RuntimeRunEvent, { event_type: 'message_delta' }>) {
  if (event.event_type === 'progress') {
    return event.label;
  }

  if (event.event_type === 'error') {
    return event.error.message;
  }

  if (event.event_type === 'end') {
    return event.result.status;
  }

  return event.event_type;
}

function should_skip_persisting_progress_event(
  event: Exclude<RuntimeRunEvent, { event_type: 'message_delta' }>,
) {
  return event.event_type === 'progress' && event.label === 'pi.thinking_delta';
}
