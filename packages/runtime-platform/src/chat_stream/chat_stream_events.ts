import type { RuntimeRunEvent, RuntimeRunEventMetadata } from '@agent-core/events/runtime_event';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { Database } from '@coworker/core';
import type {
  ArtifactItem,
  AssistantMessageItem,
  ChatContentPart,
  ChatEventSource,
  ChatStreamEvent,
  ChatStreamEventDraft,
  ChatThreadItemBase,
  ChatThreadItemStatus,
  ChatThreadItemType,
  GenerativeUiItem,
  ThinkingItem,
  ToolCallItem,
} from '@coworker/shared';
import { cap_strings_in_tool_payload, read_tool_call_approval_ask } from '@coworker/shared';
import { slim_chat_event_draft_for_storage } from '@runtime-platform/chat_stream/stored_chat_tool_items';
import { create_stored_run_events } from '@runtime-platform/orchestrator/stored_run_event_payloads';

export type {
  ArtifactItem,
  AssistantMessageItem,
  ChatContentPart,
  ChatEventSource,
  ChatItemDelta,
  ChatStreamEvent,
  ChatStreamEventDraft,
  ChatStreamEventEnvelope,
  ChatStreamEventType,
  ChatThreadItem,
  ChatThreadItemBase,
  ChatThreadItemStatus,
  ChatThreadItemType,
  GenerativeUiItem,
  SourceItem,
  StructuredChatError,
  ThinkingItem,
  ToolCallItem,
} from '@coworker/shared';

export type RuntimeEventProjectionInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  event: RuntimeRunEvent;
  assistant_item_id?: string;
  persisted_message_id?: string;
  thinking_item_id?: string;
};

export type PersistedToolCallForChatStream = {
  tool_call_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  tool_name: string;
  tool_status: string;
  input_data: unknown;
  output_data?: unknown;
  output_text?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  duration_ms?: number | null;
  output_file_id?: string | null;
  tool_call_metadata?: RuntimeRunEventMetadata;
  created_time?: Date | string;
  started_time?: Date | string | null;
  completed_time?: Date | string | null;
};

export function project_runtime_event_to_chat_event_drafts(
  input: RuntimeEventProjectionInput,
): ChatStreamEventDraft[] {
  const { event } = input;
  if (event.event_type === 'start') {
    return [
      {
        event_type: 'run_started',
        run_status: 'running',
        source: runtime_event_source(event),
      },
    ];
  }

  if (event.event_type === 'message_delta') {
    return project_message_delta(input);
  }

  if (event.event_type === 'progress') {
    return project_progress_event(input);
  }

  if (event.event_type === 'message') {
    const item = assistant_message_item(input, runtime_message_parts_to_chat_parts(event.message));
    return [{ event_type: 'item_completed', item, source: runtime_event_source(event) }];
  }

  if (event.event_type === 'error') {
    const source = runtime_event_source(event);
    return [{ event_type: 'stream_error', error: event.error, source }];
  }

  if (event.event_type === 'end') {
    return [
      {
        event_type: 'run_completed',
        run_status: run_status_from_runtime_result(event.result.status),
        source: runtime_event_source(event),
      },
    ];
  }

  return [];
}

export function create_chat_stream_event_projector() {
  const artifact_id_by_stream_key = new Map<string, string>();
  const state = create_chat_stream_projection_state();

  return (input: RuntimeEventProjectionInput): ChatStreamEventDraft[] => {
    const event = runtime_event_with_artifact_stream_id(input.event, artifact_id_by_stream_key);
    if (event.event_type === 'message' && state.has_streamed_assistant_text_since_message) {
      state.has_streamed_assistant_text_since_message = false;
      return [];
    }

    const projection_input = input_with_thread_item_ids({ ...input, event }, state);
    const drafts = project_runtime_event_to_chat_event_drafts(projection_input);
    update_chat_stream_projection_state(state, event, drafts);
    if (should_clear_artifact_stream(event)) {
      artifact_id_by_stream_key.delete(artifact_stream_key(event));
    }
    return drafts;
  };
}

type ChatStreamProjectionState = {
  active_assistant_item_id?: string;
  active_thinking_item_ids: Map<string, string>;
  has_internal_item_since_assistant_text: boolean;
  has_streamed_assistant_text_since_message: boolean;
  next_assistant_item_index: number;
  next_thinking_item_index: number;
};

function create_chat_stream_projection_state(): ChatStreamProjectionState {
  return {
    active_thinking_item_ids: new Map(),
    has_internal_item_since_assistant_text: false,
    has_streamed_assistant_text_since_message: false,
    next_assistant_item_index: 0,
    next_thinking_item_index: 0,
  };
}

function input_with_thread_item_ids(
  input: RuntimeEventProjectionInput,
  state: ChatStreamProjectionState,
): RuntimeEventProjectionInput {
  if (input.event.event_type === 'message_delta') {
    return {
      ...input,
      assistant_item_id: assistant_item_id_for_message_delta(input.run_id, input.event, state),
    };
  }

  if (input.event.event_type === 'message') {
    return {
      ...input,
      assistant_item_id: next_assistant_item_id(input.run_id, state),
    };
  }

  if (input.event.event_type === 'progress') {
    return {
      ...input,
      ...(state.active_assistant_item_id
        ? { assistant_item_id: state.active_assistant_item_id }
        : {}),
      ...thinking_item_id_for_progress(input.run_id, input.event, state),
    };
  }

  return input;
}

function assistant_item_id_for_message_delta(
  run_id: string,
  event: Extract<RuntimeRunEvent, { event_type: 'message_delta' }>,
  state: ChatStreamProjectionState,
) {
  if (
    !state.active_assistant_item_id ||
    state.has_internal_item_since_assistant_text ||
    is_first_message_delta(event)
  ) {
    state.active_assistant_item_id = next_assistant_item_id(run_id, state);
    state.has_internal_item_since_assistant_text = false;
  }

  state.has_streamed_assistant_text_since_message = true;
  return state.active_assistant_item_id;
}

function is_first_message_delta(event: Extract<RuntimeRunEvent, { event_type: 'message_delta' }>) {
  return !event.accumulated_text || event.accumulated_text === event.delta;
}

function next_assistant_item_id(run_id: string, state: ChatStreamProjectionState) {
  const item_id = `${run_id}:assistant:${state.next_assistant_item_index}`;
  state.next_assistant_item_index += 1;
  state.active_assistant_item_id = item_id;
  state.has_internal_item_since_assistant_text = false;
  return item_id;
}

function thinking_item_id_for_progress(
  run_id: string,
  event: Extract<RuntimeRunEvent, { event_type: 'progress' }>,
  state: ChatStreamProjectionState,
) {
  if (!event.label.startsWith('pi.thinking_')) return {};

  const key = thinking_content_key(event);
  if (event.label === 'pi.thinking_start' || !state.active_thinking_item_ids.has(key)) {
    state.active_thinking_item_ids.set(key, `${run_id}:thinking:${state.next_thinking_item_index}`);
    state.next_thinking_item_index += 1;
  }

  const item_id = state.active_thinking_item_ids.get(key);
  return item_id ? { thinking_item_id: item_id } : {};
}

function thinking_content_key(event: Extract<RuntimeRunEvent, { event_type: 'progress' }>) {
  return String(event.content_index ?? 0);
}

function update_chat_stream_projection_state(
  state: ChatStreamProjectionState,
  event: RuntimeRunEvent,
  drafts: ChatStreamEventDraft[],
) {
  if (drafts.some(is_internal_thread_item_draft)) {
    state.has_internal_item_since_assistant_text = true;
  }

  if (event.event_type === 'progress' && event.label === 'pi.thinking_end') {
    state.active_thinking_item_ids.delete(thinking_content_key(event));
  }
}

function is_internal_thread_item_draft(draft: ChatStreamEventDraft) {
  if (draft.event_type === 'item_started' || draft.event_type === 'item_completed') {
    return draft.item.item_type !== 'assistant_message';
  }

  if (draft.event_type === 'item_delta') {
    return draft.delta.delta_type !== 'text_delta';
  }

  return draft.event_type === 'item_updated' || draft.event_type === 'item_failed';
}

function runtime_event_with_artifact_stream_id(
  event: RuntimeRunEvent,
  artifact_id_by_stream_key: Map<string, string>,
): RuntimeRunEvent {
  if (event.event_type !== 'progress') return event;

  if (event.label === 'data-id') {
    const file_id = read_artifact_event_id(event);
    if (file_id) {
      artifact_id_by_stream_key.set(artifact_stream_key(event), file_id);
    }
    return event;
  }

  if (!is_vercel_artifact_followup_label(event.label) || read_artifact_event_id(event)) {
    return event;
  }

  const file_id = artifact_id_by_stream_key.get(artifact_stream_key(event));
  if (!file_id) return event;

  return {
    ...event,
    metadata: { ...event.metadata, file_id },
  };
}

function is_vercel_artifact_followup_label(label: string) {
  return (
    label === 'data-kind' ||
    label === 'data-title' ||
    label === 'data-clear' ||
    label === 'data-textDelta' ||
    label === 'data-codeDelta' ||
    label === 'data-finish'
  );
}

function should_clear_artifact_stream(event: RuntimeRunEvent) {
  return event.event_type === 'progress' && event.label === 'data-finish';
}

function artifact_stream_key(event: RuntimeRunEvent) {
  return String(read_progress_content_index(event) ?? 0);
}

export function create_tool_call_started_chat_event_draft(input: {
  tool_call: PersistedToolCallForChatStream;
  source_run_event_id?: string;
  source_event_sequence?: number;
}): ChatStreamEventDraft {
  return {
    event_type: 'item_started',
    item: tool_call_item({
      tool_call: input.tool_call,
      item_status: 'streaming',
      item_sequence: input.source_event_sequence ?? 0,
    }),
    source: tool_lifecycle_source(input.source_run_event_id),
  };
}

export function create_tool_call_completed_chat_event_draft(input: {
  tool_call: PersistedToolCallForChatStream;
  source_run_event_id?: string;
  source_event_sequence?: number;
}): ChatStreamEventDraft {
  const item = tool_call_item({
    tool_call: input.tool_call,
    item_status: terminal_tool_item_status(input.tool_call.tool_status),
    item_sequence: input.source_event_sequence ?? 0,
  });
  return {
    event_type: 'item_completed',
    item,
    source: tool_lifecycle_source(input.source_run_event_id),
  };
}

export async function record_chat_stream_event_drafts(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    drafts: ChatStreamEventDraft[];
    actor_id: string;
  },
) {
  const persisted_indexes = input.drafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft }) => should_persist_chat_stream_event_draft(draft));

  const rows = await create_stored_run_events(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    events: persisted_indexes.map(({ draft }) => ({
      event_type: 'chat_event' as const,
      event_label: draft.event_type,
      event_data: cap_strings_in_tool_payload(
        slim_chat_event_draft_for_storage(draft),
      ) as unknown as ChatStreamEventDraft,
      event_metadata: chat_event_metadata(draft),
    })),
  });

  const rows_by_draft_index = new Map(
    persisted_indexes.map(({ index }, position) => [index, rows[position]]),
  );

  return input.drafts.map((draft, draft_index) => {
    const row = rows_by_draft_index.get(draft_index);
    return row
      ? run_event_row_to_chat_stream_event({ ...row, event_data: draft })
      : create_volatile_chat_stream_event(input, draft, draft_index);
  });
}

function should_persist_chat_stream_event_draft(draft: ChatStreamEventDraft) {
  return draft.event_type !== 'item_delta';
}

function create_volatile_chat_stream_event(
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
  },
  draft: ChatStreamEventDraft,
  draft_index: number,
): ChatStreamEvent {
  return {
    ...draft,
    event_id: volatile_chat_stream_event_id(input.run_id, draft, draft_index),
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    sequence: draft.source.runtime_event_sequence ?? 0,
    occurred_time: new Date().toISOString(),
  } as ChatStreamEvent;
}

function volatile_chat_stream_event_id(
  run_id: string,
  draft: ChatStreamEventDraft,
  draft_index: number,
) {
  return [
    'volatile_chat_event',
    run_id,
    draft.source.runtime_event_id ?? draft.source.source_type,
    draft.event_type,
    String(draft_index),
  ].join(':');
}

export function run_event_row_to_chat_stream_event(row: {
  run_event_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  event_sequence: number;
  event_type: string;
  event_label: string | null;
  event_data: ChatStreamEventDraft;
  created_time: Date | string;
}): ChatStreamEvent {
  if (row.event_type !== 'chat_event') {
    throw new Error(`Run event is not a chat event: ${row.event_type}`);
  }

  const data = row.event_data;
  return {
    ...data,
    event_id: row.run_event_id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    run_id: row.run_id,
    sequence: row.event_sequence,
    event_type: data.event_type,
    occurred_time: iso_time(row.created_time),
    source: data.source,
  } as ChatStreamEvent;
}

function project_message_delta(input: RuntimeEventProjectionInput): ChatStreamEventDraft[] {
  const event = input.event;
  if (event.event_type !== 'message_delta') return [];

  const item_id = assistant_item_id(input);
  const drafts: ChatStreamEventDraft[] = [];
  if (!event.accumulated_text || event.accumulated_text === event.delta) {
    drafts.push({
      event_type: 'item_started',
      item: assistant_message_item(input, [{ type: 'text', text: '' }]),
      source: runtime_event_source(event),
    });
  }
  drafts.push({
    event_type: 'item_delta',
    item_id,
    delta: { delta_type: 'text_delta', text: event.delta },
    source: runtime_event_source(event),
  });
  return drafts;
}

function project_progress_event(input: RuntimeEventProjectionInput): ChatStreamEventDraft[] {
  const event = input.event;
  if (event.event_type !== 'progress') return [];

  if (event.label === 'pi.thinking_start') {
    return [
      {
        event_type: 'item_started',
        item: thinking_item(input, ''),
        source: runtime_event_source(event),
      },
    ];
  }

  if (event.label === 'pi.thinking_delta') {
    return [
      {
        event_type: 'item_delta',
        item_id: thinking_item_id(input, event.content_index),
        delta: { delta_type: 'thinking_delta', text: event.delta ?? '' },
        source: runtime_event_source(event),
      },
    ];
  }

  if (event.label === 'pi.thinking_end') {
    return [
      {
        event_type: 'item_completed',
        item: thinking_item(input, runtime_event_text(event.content), 'complete'),
        source: runtime_event_source(event),
      },
    ];
  }

  const artifact_drafts = project_artifact_progress_event(input);
  if (artifact_drafts.length > 0) return artifact_drafts;

  const generative_ui_drafts = project_generative_ui_progress_event(input);
  if (generative_ui_drafts.length > 0) return generative_ui_drafts;

  if (event.label === 'pi.tool_execution_start') {
    const tool_item = provider_tool_call_item(input, event, 'running');
    if (!tool_item) return [];
    return [{ event_type: 'item_started', item: tool_item, source: runtime_event_source(event) }];
  }

  if (event.label === 'pi.tool_execution_update') {
    const item_id = provider_tool_item_id(input.run_id, event.metadata);
    if (!item_id) return [];
    const result = event.metadata?.partial_result;
    return [
      ...(result === undefined
        ? []
        : [
            {
              event_type: 'item_delta' as const,
              item_id,
              delta: {
                delta_type: 'tool_output_delta' as const,
                output_delta: result,
                output_text_delta: summarize_unknown(result),
              },
              source: runtime_event_source(event),
            },
          ]),
      {
        event_type: 'item_updated',
        item_id,
        patch: { tool_status: 'running' } as Partial<ToolCallItem>,
        source: runtime_event_source(event),
      },
    ];
  }

  if (event.label === 'pi.tool_execution_end') {
    const tool_item = provider_tool_call_item(
      input,
      event,
      event.metadata?.is_error === true ? 'failed' : 'completed',
    );
    if (!tool_item) return [];
    return [{ event_type: 'item_completed', item: tool_item, source: runtime_event_source(event) }];
  }

  return [];
}

function project_artifact_progress_event(
  input: RuntimeEventProjectionInput,
): ChatStreamEventDraft[] {
  const event = input.event;
  if (event.event_type !== 'progress') return [];

  if (is_artifact_start_label(event.label)) {
    const item = artifact_item(input, event, 'streaming', true);
    if (!item) return [];
    return [{ event_type: 'item_started', item, source: runtime_event_source(event) }];
  }

  if (is_artifact_update_label(event.label)) {
    const file_id = read_artifact_event_id(event);
    if (!file_id) return [];
    return [
      {
        event_type: 'item_updated',
        item_id: artifact_item_id(input.run_id, file_id),
        patch: artifact_update_patch(event),
        source: runtime_event_source(event),
      },
    ];
  }

  if (is_artifact_delta_label(event.label)) {
    const file_id = read_artifact_event_id(event);
    if (!file_id) return [];
    return [
      {
        event_type: 'item_delta',
        item_id: artifact_item_id(input.run_id, file_id),
        delta: {
          delta_type: 'artifact_content_delta',
          file_id,
          content_delta: read_artifact_content_delta(event),
        },
        source: runtime_event_source(event),
      },
    ];
  }

  if (is_artifact_end_label(event.label)) {
    const item = artifact_item(input, event, 'complete', false);
    if (!item) return [];
    return [{ event_type: 'item_completed', item, source: runtime_event_source(event) }];
  }

  return [];
}

function project_generative_ui_progress_event(
  input: RuntimeEventProjectionInput,
): ChatStreamEventDraft[] {
  const event = input.event;
  if (event.event_type !== 'progress') return [];

  if (event.label === 'pi.generative_ui_start') {
    const ui_spec = read_generative_ui_spec(event);
    if (ui_spec === undefined) return [];
    return [
      {
        event_type: 'item_started',
        item: generative_ui_item(input, ui_spec),
        source: runtime_event_source(event),
      },
    ];
  }

  if (event.label === 'pi.generative_ui_delta') {
    const ui_spec_delta = read_generative_ui_spec(event);
    if (ui_spec_delta === undefined) return [];
    return [
      {
        event_type: 'item_delta',
        item_id: generative_ui_item_id(input.run_id, read_progress_content_index(event)),
        delta: { delta_type: 'generative_ui_delta', ui_spec_delta },
        source: runtime_event_source(event),
      },
    ];
  }

  if (event.label === 'pi.generative_ui_end') {
    const ui_spec = read_generative_ui_spec(event);
    if (ui_spec === undefined) return [];
    return [
      {
        event_type: 'item_completed',
        item: generative_ui_item(input, ui_spec, 'complete'),
        source: runtime_event_source(event),
      },
    ];
  }

  return [];
}

function assistant_message_item(
  input: RuntimeEventProjectionInput,
  parts: ChatContentPart[],
): AssistantMessageItem {
  const event_time = new Date().toISOString();
  return {
    ...item_base(input, assistant_item_id(input), 'assistant_message', 'streaming'),
    item_status: input.event.event_type === 'message' ? 'complete' : 'streaming',
    created_time: event_time,
    last_updated_time: event_time,
    ...(input.persisted_message_id === undefined ? {} : { message_id: input.persisted_message_id }),
    role: 'assistant',
    parts,
  };
}

function thinking_item(
  input: RuntimeEventProjectionInput,
  text: string,
  item_status: ChatThreadItemStatus = 'streaming',
): ThinkingItem {
  const content_index = 'content_index' in input.event ? input.event.content_index : undefined;
  return {
    ...item_base(input, thinking_item_id(input, content_index), 'thinking', item_status),
    text,
    is_collapsed_by_default: true,
  };
}

function generative_ui_item(
  input: RuntimeEventProjectionInput,
  ui_spec: unknown,
  item_status: ChatThreadItemStatus = 'streaming',
): GenerativeUiItem {
  const event = input.event;
  const metadata = 'metadata' in event ? (event.metadata ?? {}) : {};
  return {
    ...item_base(
      input,
      generative_ui_item_id(input.run_id, read_progress_content_index(event)),
      'generative_ui',
      item_status,
    ),
    renderer_key: metadata.renderer_key ?? 'json-render',
    ui_spec,
    ui_spec_format: read_ui_spec_format(metadata.ui_spec_format),
  };
}

function artifact_item(
  input: RuntimeEventProjectionInput,
  event: Extract<RuntimeRunEvent, { event_type: 'progress' }>,
  item_status: ChatThreadItemStatus,
  allow_generated_id: boolean,
): ArtifactItem | undefined {
  const file_id =
    read_artifact_event_id(event) ||
    (allow_generated_id ? `stream:${read_progress_content_index(event) ?? 0}` : '');
  if (!file_id) return undefined;

  const content = read_artifact_content(event);
  return {
    ...item_base(input, artifact_item_id(input.run_id, file_id), 'artifact', item_status),
    file_id,
    file_purpose: read_artifact_kind(event),
    title: read_artifact_title(event) || 'Artifact',
    ...(content === undefined ? {} : { content, content_preview: content.slice(0, 6000) }),
    ...(read_artifact_source_tool_call_id(event)
      ? { source_tool_call_id: read_artifact_source_tool_call_id(event) }
      : {}),
  };
}

function provider_tool_call_item(
  input: RuntimeEventProjectionInput,
  event: Extract<RuntimeRunEvent, { event_type: 'progress' }>,
  status: string,
): ToolCallItem | undefined {
  const metadata = event.metadata ?? {};
  const provider_tool_call_id = metadata.tool_call_id ?? '';
  const tool_name =
    metadata.tool_name ?? metadata.runtime_tool_name ?? metadata.provider_tool_name ?? '';
  if (!provider_tool_call_id || !tool_name) return undefined;

  const result = metadata.result ?? metadata.partial_result;
  const is_error = metadata.is_error === true;
  return {
    ...item_base(
      input,
      tool_item_id(input.run_id, provider_tool_call_id),
      'tool_call',
      tool_status_to_item_status(status),
    ),
    tool_call_id: provider_tool_call_id,
    parent_item_id: assistant_item_id(input),
    provider_tool_call_id,
    tool_name,
    tool_kind: tool_kind_for_name(tool_name),
    tool_status: status,
    ...(metadata.args === undefined ? {} : { input_data: metadata.args }),
    ...(result === undefined ? {} : { output_data: result }),
    ...(result === undefined ? {} : { output_text: summarize_unknown(result) }),
    ...(is_error
      ? { error: { code: 'tool_error', message: summarize_unknown(result) || 'Tool failed' } }
      : {}),
    file_ids: [],
  };
}

function tool_call_item(input: {
  tool_call: PersistedToolCallForChatStream;
  item_status: ChatThreadItemStatus;
  item_sequence: number;
}): ToolCallItem {
  const metadata = input.tool_call.tool_call_metadata ?? {};
  const provider_tool_call_id = metadata.runtime_tool_call_id ?? metadata.model_tool_call_id ?? '';
  const item_id = tool_item_id(
    input.tool_call.run_id,
    provider_tool_call_id || input.tool_call.tool_call_id,
  );
  const time = iso_time(
    input.tool_call.started_time ?? input.tool_call.created_time ?? new Date().toISOString(),
  );
  return {
    item_id,
    workspace_id: input.tool_call.workspace_id,
    session_id: input.tool_call.session_id,
    run_id: input.tool_call.run_id,
    item_type: 'tool_call',
    item_status: input.item_status,
    item_sequence: input.item_sequence,
    created_time: time,
    last_updated_time: iso_time(
      input.tool_call.completed_time ??
        input.tool_call.started_time ??
        input.tool_call.created_time ??
        time,
    ),
    tool_call_id: input.tool_call.tool_call_id,
    parent_item_id: default_assistant_item_id(input.tool_call.run_id),
    ...(provider_tool_call_id ? { provider_tool_call_id } : {}),
    tool_name: input.tool_call.tool_name,
    tool_kind: tool_kind_for_name(input.tool_call.tool_name),
    tool_status: input.tool_call.tool_status,
    input_data: input.tool_call.input_data,
    ...(input.tool_call.output_data === undefined
      ? {}
      : { output_data: input.tool_call.output_data }),
    ...(input.tool_call.output_text ? { output_text: input.tool_call.output_text } : {}),
    ...(input.tool_call.error_message
      ? {
          error: {
            code: input.tool_call.error_code ?? 'tool_error',
            message: input.tool_call.error_message,
          },
        }
      : {}),
    ...(input.tool_call.duration_ms === null || input.tool_call.duration_ms === undefined
      ? {}
      : { duration_ms: input.tool_call.duration_ms }),
    file_ids: input.tool_call.output_file_id ? [input.tool_call.output_file_id] : [],
    ...read_tool_call_approval_ask(metadata),
  };
}

function item_base<const ItemType extends ChatThreadItemType>(
  input: RuntimeEventProjectionInput,
  item_id: string,
  item_type: ItemType,
  item_status: ChatThreadItemStatus,
): ChatThreadItemBase & { item_type: ItemType } {
  const time = new Date().toISOString();
  return {
    item_id,
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    item_type,
    item_status,
    item_sequence: input.event.event_sequence,
    created_time: time,
    last_updated_time: time,
  };
}

function runtime_message_parts_to_chat_parts(message: RuntimeAgentMessage): ChatContentPart[] {
  return message.content.flatMap((part): ChatContentPart[] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.type === 'image') {
      return [
        {
          type: 'image',
          mime_type: part.mime_type,
          ...(part.detail ? { detail: part.detail } : {}),
        },
      ];
    }
    if (part.type === 'file') {
      return [
        {
          type: 'file',
          ...(part.file_id ? { file_id: part.file_id } : {}),
          ...(part.name ? { name: part.name } : {}),
          ...(part.mime_type ? { mime_type: part.mime_type } : {}),
        },
      ];
    }
    if (part.type === 'tool_call') return [{ type: 'tool_reference', tool_call_id: part.id }];
    return [];
  });
}

function runtime_event_source(event: RuntimeRunEvent): ChatEventSource {
  const metadata = 'metadata' in event ? (event.metadata ?? {}) : {};
  const start_model = event.event_type === 'start' ? event.model : undefined;
  const provider_key =
    start_model?.model_proxy ??
    start_model?.model_provider ??
    metadata.model_proxy ??
    metadata.provider ??
    '';
  const model_id = start_model?.model_name ?? metadata.model ?? '';
  return {
    source_type: 'runtime_event',
    runtime_event_id: event.event_id,
    runtime_event_sequence: event.event_sequence,
    ...(provider_key ? { provider_key } : {}),
    ...(model_id ? { model_id } : {}),
  };
}

function tool_lifecycle_source(source_run_event_id: string | undefined): ChatEventSource {
  return {
    source_type: 'tool_lifecycle',
    ...(source_run_event_id === undefined ? {} : { runtime_event_id: source_run_event_id }),
  };
}

function chat_event_metadata(draft: ChatStreamEventDraft): Record<string, unknown> {
  return {
    source_type: draft.source.source_type,
    ...(draft.source.runtime_event_id
      ? { source_runtime_event_id: draft.source.runtime_event_id }
      : {}),
    ...(draft.source.runtime_event_sequence === undefined
      ? {}
      : { source_runtime_event_sequence: draft.source.runtime_event_sequence }),
    ...('item' in draft ? { item_id: draft.item.item_id, item_type: draft.item.item_type } : {}),
    ...('item_id' in draft ? { item_id: draft.item_id } : {}),
  };
}

function run_status_from_runtime_result(status: string) {
  if (status === 'aborted') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'completed';
}

function terminal_tool_item_status(tool_status: string): ChatThreadItemStatus {
  if (['completed'].includes(tool_status)) return 'complete';
  if (['failed', 'blocked', 'timed_out'].includes(tool_status)) return 'failed';
  if (tool_status === 'cancelled') return 'cancelled';
  return 'streaming';
}

function tool_status_to_item_status(tool_status: string): ChatThreadItemStatus {
  if (tool_status === 'completed') return 'complete';
  if (tool_status === 'failed') return 'failed';
  return 'streaming';
}

function tool_kind_for_name(tool_name: string): ToolCallItem['tool_kind'] {
  if (tool_name.includes('browser')) return 'browser';
  if (tool_name.includes('slack') || tool_name.includes('gmail')) return 'integration';
  if (tool_name.includes('workflow')) return 'workflow';
  if (tool_name.includes('exec') || tool_name.includes('command') || tool_name === 'bash') {
    return 'command';
  }
  if (tool_name.includes('file') || tool_name.includes('read') || tool_name.includes('write')) {
    return 'file';
  }
  return 'custom';
}

function assistant_item_id(input: RuntimeEventProjectionInput) {
  return input.assistant_item_id ?? default_assistant_item_id(input.run_id);
}

function default_assistant_item_id(run_id: string) {
  return `${run_id}:assistant:0`;
}

function thinking_item_id(input: RuntimeEventProjectionInput, content_index: number | undefined) {
  return input.thinking_item_id ?? `${input.run_id}:thinking:${content_index ?? 0}`;
}

function artifact_item_id(run_id: string, file_id: string) {
  return `${run_id}:artifact:${file_id}`;
}

function generative_ui_item_id(run_id: string, content_index: number | undefined) {
  return `${run_id}:generative_ui:${content_index ?? 0}`;
}

function provider_tool_item_id(run_id: string, metadata: RuntimeRunEventMetadata | undefined) {
  const tool_call_id = metadata?.tool_call_id ?? '';
  return tool_call_id ? tool_item_id(run_id, tool_call_id) : undefined;
}

function tool_item_id(run_id: string, tool_call_id: string) {
  return `${run_id}:tool:${tool_call_id}`;
}

function runtime_event_text(value: unknown) {
  if (typeof value === 'string') return value;
  if (is_plain_object(value) && typeof value.text === 'string') return value.text;
  if (is_plain_object(value) && typeof value.thinking === 'string') return value.thinking;
  return summarize_unknown(value);
}

function read_generative_ui_spec(event: Extract<RuntimeRunEvent, { event_type: 'progress' }>) {
  const metadata = event.metadata ?? {};
  if (metadata.ui_spec !== undefined) return metadata.ui_spec;
  if (metadata.spec !== undefined) return metadata.spec;
  if (metadata.ui_spec_delta !== undefined) return metadata.ui_spec_delta;
  if (metadata.spec_delta !== undefined) return metadata.spec_delta;
  if (event.content !== undefined) return parse_json_text_if_needed(event.content);
  if (event.delta !== undefined) return parse_json_text_if_needed(event.delta);
  return undefined;
}

function is_artifact_start_label(label: string) {
  return label === 'pi.artifact_start' || label === 'data-id';
}

function is_artifact_update_label(label: string) {
  return label === 'data-kind' || label === 'data-title' || label === 'data-clear';
}

function is_artifact_delta_label(label: string) {
  return label === 'pi.artifact_delta' || label === 'data-textDelta' || label === 'data-codeDelta';
}

function is_artifact_end_label(label: string) {
  return label === 'pi.artifact_end' || label === 'data-finish';
}

function artifact_update_patch(
  event: Extract<RuntimeRunEvent, { event_type: 'progress' }>,
): Partial<ArtifactItem> {
  if (event.label === 'data-kind') return { file_purpose: read_artifact_kind(event) };
  if (event.label === 'data-title') return { title: read_artifact_title(event) || 'Artifact' };
  return { content: '', content_preview: '' };
}

function read_artifact_event_id(event: Extract<RuntimeRunEvent, { event_type: 'progress' }>) {
  const metadata = event.metadata ?? {};
  if (metadata.file_id) return metadata.file_id;
  if (metadata.id) return metadata.id;
  if (metadata.document_id) return metadata.document_id;
  if (event.label === 'data-id') return read_progress_data_string(event);
  return '';
}

function read_artifact_kind(
  event: Extract<RuntimeRunEvent, { event_type: 'progress' }>,
): ArtifactItem['file_purpose'] {
  const metadata = event.metadata ?? {};
  const candidate =
    metadata.file_purpose ??
    metadata.kind ??
    (event.label === 'data-kind' ? read_progress_data_string(event) : '');
  if (
    candidate === 'text' ||
    candidate === 'code' ||
    candidate === 'sheet' ||
    candidate === 'image' ||
    candidate === 'json' ||
    candidate === 'file' ||
    candidate === 'html' ||
    candidate === 'custom'
  ) {
    return candidate;
  }

  return event.label === 'data-codeDelta' ? 'code' : 'text';
}

function read_artifact_title(event: Extract<RuntimeRunEvent, { event_type: 'progress' }>) {
  const metadata = event.metadata ?? {};
  return (
    metadata.title ??
    metadata.artifact_title ??
    (event.label === 'data-title' ? read_progress_data_string(event) : '')
  );
}

function read_artifact_source_tool_call_id(
  event: Extract<RuntimeRunEvent, { event_type: 'progress' }>,
) {
  const metadata = event.metadata ?? {};
  return metadata.tool_call_id ?? metadata.source_tool_call_id ?? '';
}

function read_artifact_content(event: Extract<RuntimeRunEvent, { event_type: 'progress' }>) {
  const metadata = event.metadata ?? {};
  if (metadata.content !== undefined) return metadata.content;
  if (metadata.content_preview !== undefined) return metadata.content_preview;
  if (event.label === 'data-clear') return '';
  return undefined;
}

function read_artifact_content_delta(event: Extract<RuntimeRunEvent, { event_type: 'progress' }>) {
  const metadata = event.metadata ?? {};
  if (metadata.content_delta !== undefined) return metadata.content_delta;
  if (metadata.delta !== undefined) return metadata.delta;
  if (metadata.text_delta !== undefined) return metadata.text_delta;
  if (metadata.code_delta !== undefined) return metadata.code_delta;
  return read_progress_data_string(event);
}

function read_progress_data_string(event: Extract<RuntimeRunEvent, { event_type: 'progress' }>) {
  const metadata = event.metadata ?? {};
  if (metadata.data !== undefined) return metadata.data;
  if (metadata.text !== undefined) return metadata.text;
  if (metadata.code !== undefined) return metadata.code;
  if (typeof event.content === 'string') return event.content;
  if (typeof event.delta === 'string') return event.delta;
  return '';
}

function parse_json_text_if_needed(value: unknown) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function read_progress_content_index(event: RuntimeRunEvent) {
  return 'content_index' in event && typeof event.content_index === 'number'
    ? event.content_index
    : undefined;
}

function read_ui_spec_format(value: unknown): GenerativeUiItem['ui_spec_format'] {
  return value === 'custom' ? 'custom' : 'json-render';
}

function summarize_unknown(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function iso_time(value: Date | string | null | undefined) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
