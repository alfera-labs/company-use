import type { ToolCallApprovalAsk } from '@coworker/shared';
import { read_live_tool_call_metadata } from '@/components/app/chat_live_tool_call_metadata';
import { run_started_by } from '@/components/app/chat_own_copy_order';
import { entries_people_see } from '@/components/app/chat_reply_steps';
import {
  format_chat_text,
  read_chat_message_files,
  read_chat_message_images,
  tool_result_part_text,
} from '@/components/app/chat_timeline';
import type { CatalogNode, ChatStreamEvent, RunMessage, ToolCall } from '@/lib/api';
import { resolve_system_tool_label } from '@/lib/system_tool_icon';

const tool_name_version_suffix_re = /-\d+$/u;
const label_word_separator_re = /[_-]+/gu;
const label_collapse_whitespace_re = /\s+/gu;
const label_word_start_re = /\b\w/gu;
const assistant_segment_index_re = /:assistant:(\d+)$/u;
const assistant_segment_prefix_re = /^(.*:assistant:)\d+$/u;

export type ChatToolCall = {
  tool_call_id: string;
  run_id: string;
  parent_item_id?: string | undefined;
  item_sequence?: number | undefined;
  tool_name: string;
  tool_status: string;
  input_data: unknown;
  output_data?: unknown | undefined;
  output_text?: string | null | undefined;
  output_file_id?: string | null | undefined;
  file_ids?: string[] | undefined;
  error_code?: string | null | undefined;
  error_message?: string | null | undefined;
  duration_ms?: number | null | undefined;
  tool_call_metadata?: ToolCallMetadata & Record<string, unknown>;
  created_time?: string | undefined;
  started_time?: string | null | undefined;
  completed_time?: string | null | undefined;
};

type ToolCallData = {
  node_key?: string;
  node_name?: string;
  app_name?: string;
  node_display_name?: string;
  tool_label?: string;
  app_display_name?: string;
  display?: {
    title?: string;
    subtitle?: string;
  };
};

type ToolCallOutput = {
  data?: ToolCallData;
  metadata?: { node_key?: string };
};

type ToolCallMetadata = {
  runtime_tool_call_id?: string;
  model_tool_call_id?: string;
  approval_request_id?: string;
  approval_labels?: string[];
  approval_display_fields?: string[];
  approval_needs_a_person?: boolean;
};

type ProjectedSourceActor = {
  source_actor_id: string;
  actor_kind?: string;
  external_ids: Array<{ provider_key: string; external_user_id: string }>;
  profile: {
    real_name?: string | null | undefined;
    display_name?: string | null | undefined;
    username?: string | null | undefined;
  };
};

export type ChatThinkingActivity = {
  item_id: string;
  run_id: string;
  text: string;
  is_active: boolean;
};

export type ChatThreadProjectionItem = {
  item_id: string;
  run_id: string;
  item_type: string;
  item_status: string;
  item_sequence: number;
  created_time?: string;
  last_updated_time?: string;
  message_id?: string;
  parts?: Array<{ type: string; text?: string; markdown?: string }>;
  text?: string;
  tool_call_id?: string;
  parent_item_id?: string;
  provider_tool_call_id?: string;
  approval?: ToolCallApprovalAsk;
  tool_name?: string;
  tool_status?: string;
  input_data?: unknown;
  output_data?: unknown;
  output_text?: string;
  output_file_id?: string;
  file_ids?: string[];
  error?: { code?: string; message?: string };
  duration_ms?: number;
  file_id?: string;
  file_purpose?: string;
  title?: string;
  content?: string;
  content_preview?: string;
  source_tool_call_id?: string;
  renderer_key?: string;
  ui_spec?: unknown;
  ui_spec_format?: string;
  source?: {
    source_id: string;
    title?: string;
    citation_text?: string;
  };
};

export type ChatThreadProjection = {
  active_assistant_text_item_id?: string;
  event_ids: Record<string, true>;
  has_internal_item_since_assistant_text?: boolean;
  items: ChatThreadProjectionItem[];
  last_sequence?: number;
  next_assistant_text_index?: number;
  next_item_sequence?: number;
};

type ChatItemDelta = Extract<ChatStreamEvent, { event_type: 'item_delta' }>['delta'];
type ChatThreadItem = Extract<
  ChatStreamEvent,
  { event_type: 'item_started' | 'item_completed' }
>['item'];

export type ProjectedChatMessage = {
  id: string;
  run_id?: string;
  started_run_id?: string;
  role: 'user' | 'assistant' | 'system';
  authored_by_system?: true;
  parts: ProjectedChatMessagePart[];
  sender?: {
    source_actor_id: string;
    display_name: string;
  };
  sent_time?: string;
};

export type ProjectedChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string; name?: string }
  | {
      type: 'file';
      fileId?: string;
      name?: string;
      mimeType?: string;
      isInlineText?: boolean;
    }
  | {
      type: 'reasoning';
      text: string;
      state?: 'streaming' | 'complete';
      durationMs?: number;
    }
  | ProjectedChatToolPart
  | { type: 'artifact'; artifactId: string; title?: string; kind?: string; contentPreview?: string }
  | { type: 'source'; sourceId: string; title?: string; citationText?: string };

export type ProjectedChatToolPart = {
  type: `tool-${string}`;
  toolCallId: string;
  canonicalId?: string;
  toolName: string;
  state: string;
  createdTime?: string;
  input?: unknown;
  output?: unknown;
  outputText?: string;
  errorCode?: string;
  errorText?: string;
  durationMs?: number;
  inputSchema?: unknown;
  approvalRequestId?: string;
  approvalLabels?: string[];
  approvalDisplayFields?: string[];
  approvalNeedsAPerson?: boolean;
  display?: {
    appId?: string;
    appName?: string;
    iconUrl?: string;
    title?: string;
    subtitle?: string;
  };
};

export function create_empty_chat_thread_projection(): ChatThreadProjection {
  return { event_ids: {}, items: [] };
}

type ProjectedChatMessagesInput = {
  active_run_id?: string;
  artifact_items?: ChatThreadProjectionItem[];
  assistant_message_items?: ChatThreadProjectionItem[];
  catalog_nodes?: CatalogNode[];
  messages: RunMessage[];
  source_actors?: ProjectedSourceActor[];
  source_items?: ChatThreadProjectionItem[];
  stopped_run_ids?: readonly string[];
  thinking_items?: ChatThreadProjectionItem[];
  tool_calls: ChatToolCall[];
};

export function create_projected_chat_messages(
  input: ProjectedChatMessagesInput,
): ProjectedChatMessage[] {
  const catalog_nodes_by_key = new Map(
    (input.catalog_nodes ?? []).map((node) => [node.node_key, node]),
  );
  const rendered_tool_call_ids = new Set<string>();
  const persisted_entries = project_persisted_run_message_entries({
    messages: input.messages,
    source_actors: input.source_actors ?? [],
    rendered_tool_call_ids,
    tool_calls: input.tool_calls,
    catalog_nodes_by_key,
  });
  const stopped_run_ids = (input.stopped_run_ids ?? []).filter(
    (run_id) => run_id !== input.active_run_id,
  );
  const shown = { catalog_nodes_by_key, rendered_tool_call_ids };
  return projected_messages_from_entries([
    ...persisted_entries,
    ...stopped_run_ids.flatMap((run_id) => project_unsaved_run_entries(input, run_id, shown, true)),
    ...(input.active_run_id
      ? project_unsaved_run_entries(input, input.active_run_id, shown, false)
      : []),
  ]);
}

function project_unsaved_run_entries(
  input: ProjectedChatMessagesInput,
  run_id: string,
  shown: { catalog_nodes_by_key: Map<string, CatalogNode>; rendered_tool_call_ids: Set<string> },
  run_is_stopped: boolean,
) {
  const saved_assistant_texts = visible_assistant_text_set(input.messages, run_id);
  const saved_reasoning_texts = visible_reasoning_text_set(input.messages, run_id);
  const saved_tool_call_ids = persisted_tool_call_id_set(input.messages);
  const of_run = (item: { run_id?: string | null }) => item.run_id === run_id;
  const item_text = (item: ChatThreadProjectionItem) => item.text ?? read_item_text(item);
  return project_live_run_message_entries({
    active_run_id: run_id,
    run_is_stopped,
    artifact_items: (input.artifact_items ?? []).filter(of_run),
    assistant_message_items: (input.assistant_message_items ?? [])
      .filter(of_run)
      .filter((item) => read_item_text(item).trim())
      .filter((item) => !saved_assistant_texts.has(comparable_chat_text(read_item_text(item)))),
    catalog_nodes_by_key: shown.catalog_nodes_by_key,
    sequence_anchor: active_run_tail_sequence(input.messages, run_id),
    source_items: (input.source_items ?? []).filter(of_run),
    thinking_items: (input.thinking_items ?? [])
      .filter(of_run)
      .filter(is_visible_reasoning_item)
      .filter((item) => !saved_reasoning_texts.has(comparable_chat_text(item_text(item)))),
    tool_calls: input.tool_calls.filter(
      (tool_call) =>
        of_run(tool_call) &&
        !shown.rendered_tool_call_ids.has(tool_call.tool_call_id) &&
        !shown.rendered_tool_call_ids.has(canonical_tool_call_key(tool_call)) &&
        !saved_tool_call_ids.has(tool_call.tool_call_id),
    ),
  });
}

type LiveTimelineEntry = {
  message_id?: string;
  occurred_time: number | undefined;
  part: ProjectedChatMessagePart;
  rank: number;
  sequence: number | undefined;
};

type ProjectedMessageEntry = {
  message: ProjectedChatMessage;
  local_sequence?: number;
  occurred_time: number | undefined;
  sequence: number;
};

type PersistedRunMessagesInput = {
  catalog_nodes_by_key: Map<string, CatalogNode>;
  messages: RunMessage[];
  source_actors: ProjectedSourceActor[];
  rendered_tool_call_ids: Set<string>;
  tool_calls: ChatToolCall[];
};

function project_persisted_run_message_entries(input: PersistedRunMessagesInput) {
  const tool_calls_by_id = new Map(
    input.tool_calls.map((tool_call) => [tool_call.tool_call_id, tool_call]),
  );
  const entries: ProjectedMessageEntry[] = [];
  const source_actors_by_external_user = index_source_actors(input.source_actors);

  for (const message of [...input.messages].sort(compare_run_messages)) {
    const visible_message = project_visible_run_message(message, source_actors_by_external_user);
    if (visible_message) {
      if (visible_message.role === 'assistant') {
        const requested_tool_parts = project_requested_tool_call_parts(
          message,
          input.tool_calls,
          input.catalog_nodes_by_key,
        );
        requested_tool_parts.forEach((part) => {
          input.rendered_tool_call_ids.add(part.toolCallId);
          input.rendered_tool_call_ids.add(chat_tool_part_key(part));
        });
        visible_message.parts.push(...requested_tool_parts);
      }
      const visible_entry = {
        message: visible_message,
        occurred_time: run_message_time(message),
        sequence: run_message_sequence(message),
      };
      entries.push(visible_entry);
      continue;
    }

    const internal_part = project_persisted_internal_part(message, input, tool_calls_by_id);
    if (!internal_part) continue;

    if (is_chat_tool_part(internal_part)) {
      input.rendered_tool_call_ids.add(internal_part.toolCallId);
      input.rendered_tool_call_ids.add(chat_tool_part_key(internal_part));
    }
    entries.push(create_persisted_internal_entry(message, internal_part));
  }

  return entries;
}

function project_visible_run_message(
  message: RunMessage,
  source_actors_by_external_user: Map<string, ProjectedSourceActor>,
): ProjectedChatMessage | undefined {
  if (!is_projected_chat_role(message.message_role)) return undefined;
  if (!is_user_visible_message(message)) return undefined;

  const parts = project_visible_message_parts(message);
  if (parts.length === 0) return undefined;
  const sender = read_message_sender(message, source_actors_by_external_user);
  const sent_time = project_message_sent_time(message);

  return {
    id: message.run_message_id,
    parts,
    role: message.message_role,
    ...(is_system_authored_user_message(message) ? { authored_by_system: true as const } : {}),
    ...(message.message_role === 'assistant' && message.run_id ? { run_id: message.run_id } : {}),
    ...run_started_by(message),
    ...(sender ? { sender } : {}),
    ...(sent_time ? { sent_time } : {}),
  };
}

function is_system_authored_user_message(message: RunMessage) {
  return message.message_role === 'user' && Boolean(message.source_metadata?.trigger_id);
}

function project_visible_message_parts(message: RunMessage): ProjectedChatMessagePart[] {
  const attachment_parts = [
    ...project_message_image_parts(message),
    ...project_message_file_parts(message),
  ];

  if (message.message_role !== 'assistant') {
    const text = format_chat_text(read_chat_message_text(message.message_content));
    return text.trim() ? [...attachment_parts, { type: 'text', text }] : attachment_parts;
  }

  const content_parts = message.message_content.parts ?? [];
  const parts = [
    ...attachment_parts,
    ...content_parts.flatMap(project_visible_assistant_content_part),
  ];
  const text = format_chat_text(read_chat_message_text(message.message_content));
  if (text.trim() && !parts.some((part) => part.type === 'text')) {
    parts.push({ type: 'text', text });
  }
  return parts;
}

function project_message_image_parts(message: RunMessage): ProjectedChatMessagePart[] {
  return read_chat_message_images(message.message_content).map((image) => ({
    type: 'image',
    dataUrl: image.data_url,
    ...(image.name ? { name: image.name } : {}),
  }));
}

function project_message_file_parts(message: RunMessage): ProjectedChatMessagePart[] {
  return read_chat_message_files(message.message_content).map((file) => ({
    type: 'file',
    ...(file.file_id ? { fileId: file.file_id } : {}),
    ...(file.name ? { name: file.name } : {}),
    ...(file.mime_type ? { mimeType: file.mime_type } : {}),
    ...(file.is_inline_text ? { isInlineText: true } : {}),
  }));
}

function project_visible_assistant_content_part(
  part: NonNullable<RunMessage['message_content']['parts']>[number],
): ProjectedChatMessagePart[] {
  if (part.type === 'thinking') {
    const text = format_chat_text(part.thinking);
    return text ? [{ type: 'reasoning', text, state: 'complete' }] : [];
  }
  if (part.type === 'text') {
    const text = format_chat_text(part.text);
    return text ? [{ type: 'text', text }] : [];
  }
  return [];
}

function index_source_actors(source_actors: ProjectedSourceActor[]) {
  const source_actors_by_external_user = new Map<string, ProjectedSourceActor>();
  for (const source_actor of source_actors) {
    for (const external_id of source_actor.external_ids) {
      source_actors_by_external_user.set(
        `${external_id.provider_key}:${external_id.external_user_id}`,
        source_actor,
      );
    }
  }
  return source_actors_by_external_user;
}

function read_message_sender(
  message: RunMessage,
  source_actors_by_external_user: Map<string, ProjectedSourceActor>,
) {
  if (message.message_role !== 'user') return undefined;
  const source_metadata = message.source_metadata ?? {};
  const external_user_id = source_metadata.slack?.user_id;
  const embedded_source_actor = source_metadata.source_actor;
  const source_actor =
    embedded_source_actor ??
    (external_user_id
      ? source_actors_by_external_user.get(`slack:${external_user_id}`)
      : undefined);
  const source_actor_id = source_actor?.source_actor_id;
  const profile = source_actor?.profile;
  const display_name = profile?.real_name ?? profile?.display_name ?? profile?.username;
  if (!source_actor_id || !display_name) return undefined;
  return { source_actor_id, display_name };
}

function project_message_sent_time(message: RunMessage) {
  const event_time_seconds = Number.parseFloat(message.source_metadata?.slack?.event_ts ?? '');
  if (Number.isFinite(event_time_seconds)) {
    return new Date(event_time_seconds * 1000).toISOString();
  }
  return message.created_time;
}

function project_persisted_internal_part(
  message: RunMessage,
  input: PersistedRunMessagesInput,
  tool_calls_by_id: Map<string, ChatToolCall>,
): ProjectedChatMessagePart | undefined {
  if (is_persisted_reasoning_message(message)) {
    const text = format_chat_text(read_reasoning_message_text(message.message_content));
    if (!text.trim()) return undefined;
    return { type: 'reasoning', text, state: 'complete' };
  }

  if (message.message_role !== 'tool_result' || !message.tool_call_id) return undefined;
  if (input.rendered_tool_call_ids.has(message.tool_call_id)) return undefined;

  const tool_call = tool_calls_by_id.get(message.tool_call_id);
  if (tool_call) return project_tool_call_part(tool_call, input.catalog_nodes_by_key);

  return project_tool_result_message_part(message);
}

function create_persisted_internal_entry(
  message: RunMessage,
  part: ProjectedChatMessagePart,
): ProjectedMessageEntry {
  return {
    message: {
      id: `${message.run_id}:internal:${run_message_sequence(message)}`,
      parts: [part],
      role: 'assistant',
      run_id: message.run_id,
    },
    occurred_time: run_message_time(message),
    sequence: run_message_sequence(message),
  };
}

function project_tool_result_message_part(message: RunMessage): ProjectedChatToolPart {
  const tool_name = read_tool_result_message_tool_name(message);
  const created_time = message.created_time;
  return {
    type: `tool-${tool_name}`,
    toolCallId: message.tool_call_id ?? message.run_message_id,
    toolName: tool_name,
    state: 'completed',
    output: read_chat_message_text(message.message_content),
    ...(created_time ? { createdTime: created_time } : {}),
  };
}

function project_requested_tool_call_parts(
  message: RunMessage,
  tool_calls: ChatToolCall[],
  catalog_nodes_by_key: Map<string, CatalogNode>,
) {
  const tool_calls_by_request_id = tool_calls_by_requested_id(tool_calls);
  return requested_tool_call_ids_from_message(message)
    .map((request_id) => tool_calls_by_request_id.get(request_id))
    .filter((tool_call): tool_call is ChatToolCall => Boolean(tool_call))
    .map((tool_call) => project_tool_call_part(tool_call, catalog_nodes_by_key));
}

function project_live_run_message_entries(input: {
  active_run_id: string;
  artifact_items: ChatThreadProjectionItem[];
  assistant_message_items: ChatThreadProjectionItem[];
  catalog_nodes_by_key: Map<string, CatalogNode>;
  sequence_anchor: number;
  source_items: ChatThreadProjectionItem[];
  thinking_items: ChatThreadProjectionItem[];
  tool_calls: ChatToolCall[];
  run_is_stopped: boolean;
}): ProjectedMessageEntry[] {
  const entries: LiveTimelineEntry[] = [];

  for (const item of input.assistant_message_items) {
    const parts = text_parts_from_projection_item(item);
    parts.forEach((part, index) => {
      entries.push({
        message_id: item.item_id,
        occurred_time: read_optional_time(item.created_time),
        part,
        rank: 20 + index,
        sequence: item.item_sequence,
      });
    });
  }

  for (const item of input.thinking_items) {
    const duration_ms = projection_item_duration_ms(item);
    entries.push({
      occurred_time: read_optional_time(item.created_time),
      part: {
        type: 'reasoning',
        text: item.text ?? read_item_text(item),
        state: is_active_thinking_item(item) && !input.run_is_stopped ? 'streaming' : 'complete',
        ...(duration_ms === undefined ? {} : { durationMs: duration_ms }),
      },
      rank: 10,
      sequence: item.item_sequence,
    });
  }

  for (const item of input.source_items) {
    const source = item.source;
    if (!source) continue;
    const title = source.title;
    const citation_text = source.citation_text;
    entries.push({
      occurred_time: read_optional_time(item.created_time),
      part: {
        type: 'source',
        sourceId: source.source_id,
        ...(title ? { title } : {}),
        ...(citation_text ? { citationText: citation_text } : {}),
      },
      rank: 5,
      sequence: item.item_sequence,
    });
  }

  for (const tool_call of input.tool_calls) {
    entries.push({
      occurred_time: read_optional_time(tool_call.created_time ?? tool_call.started_time),
      part: project_tool_call_part(tool_call, input.catalog_nodes_by_key),
      rank: 30,
      sequence: tool_call.item_sequence,
    });
  }

  for (const item of input.artifact_items) {
    const file_id = item.file_id ?? item.item_id;
    const content_preview = (item.content ?? item.content_preview ?? '').slice(0, 1500);
    entries.push({
      occurred_time: read_optional_time(item.created_time),
      part: {
        type: 'artifact',
        artifactId: file_id,
        ...(item.title ? { title: item.title } : {}),
        ...(item.file_purpose ? { kind: item.file_purpose } : {}),
        ...(content_preview ? { contentPreview: content_preview } : {}),
      },
      rank: 40,
      sequence: item.item_sequence,
    });
  }

  return chronological_live_message_entries({
    active_run_id: input.active_run_id,
    entries,
    sequence_anchor: input.sequence_anchor,
  });
}

function projection_item_duration_ms(item: ChatThreadProjectionItem) {
  if (item.duration_ms !== undefined) return item.duration_ms;
  if (!item.created_time || !item.last_updated_time) return undefined;

  const started_time = Date.parse(item.created_time);
  const completed_time = Date.parse(item.last_updated_time);
  if (!Number.isFinite(started_time) || !Number.isFinite(completed_time)) return undefined;
  const duration_ms = completed_time - started_time;
  return duration_ms > 0 ? duration_ms : undefined;
}

function chronological_live_message_entries(input: {
  active_run_id: string;
  entries: LiveTimelineEntry[];
  sequence_anchor: number;
}) {
  return sort_live_timeline_entries(input.entries).map((entry, index) => ({
    message: {
      id:
        entry.message_id ??
        `${input.active_run_id}:live:${entry.sequence ?? part_sort_key(entry.part)}`,
      parts: [entry.part],
      role: 'assistant' as const,
      run_id: input.active_run_id,
    },
    local_sequence: index + 1,
    occurred_time: entry.occurred_time,
    sequence: input.sequence_anchor,
  }));
}

function projected_messages_from_entries(entries: ProjectedMessageEntry[]) {
  const messages = entries_people_see(entries)
    .sort(compare_projected_message_entries)
    .map((entry) => entry.message);

  return join_adjacent_assistant_blocks(messages);
}

function join_adjacent_assistant_blocks(messages: ProjectedChatMessage[]) {
  const joined_messages: ProjectedChatMessage[] = [];

  for (const message of messages) {
    const current_message = { ...message, parts: [...message.parts] };
    const previous_message = joined_messages.at(-1);
    if (!can_join_assistant_blocks(previous_message, current_message)) {
      joined_messages.push(current_message);
      continue;
    }
    previous_message.parts.push(...current_message.parts);
  }

  return joined_messages;
}

function can_join_assistant_blocks(
  previous_message: ProjectedChatMessage | undefined,
  current_message: ProjectedChatMessage,
): previous_message is ProjectedChatMessage {
  return Boolean(
    previous_message?.role === 'assistant' &&
      current_message.role === 'assistant' &&
      previous_message.run_id &&
      previous_message.run_id === current_message.run_id,
  );
}

function compare_projected_message_entries(
  left: ProjectedMessageEntry,
  right: ProjectedMessageEntry,
) {
  const occurred_time_delta = compare_entry_time(left.occurred_time, right.occurred_time);
  if (occurred_time_delta !== undefined && occurred_time_delta !== 0) return occurred_time_delta;

  return (
    left.sequence - right.sequence ||
    (left.local_sequence ?? 0) - (right.local_sequence ?? 0) ||
    left.message.id.localeCompare(right.message.id)
  );
}

function compare_entry_time(left: number | undefined, right: number | undefined) {
  if (left === undefined || right === undefined) return undefined;
  return left - right;
}

function sort_live_timeline_entries(entries: LiveTimelineEntry[]) {
  return [...entries].sort(compare_live_timeline_entries);
}

function compare_live_timeline_entries(left: LiveTimelineEntry, right: LiveTimelineEntry) {
  const sequence_delta = compare_optional_number(left.sequence, right.sequence);
  if (sequence_delta !== undefined && sequence_delta !== 0) return sequence_delta;

  const occurred_time_delta = compare_entry_time(left.occurred_time, right.occurred_time);
  if (occurred_time_delta !== undefined && occurred_time_delta !== 0) return occurred_time_delta;

  if (left.sequence === undefined && right.sequence !== undefined) return 1;
  if (left.sequence !== undefined && right.sequence === undefined) return -1;
  return (
    left.rank - right.rank || part_sort_key(left.part).localeCompare(part_sort_key(right.part))
  );
}

function text_parts_from_projection_item(item: ChatThreadProjectionItem) {
  const parts = item.parts ?? [];
  const text_parts = parts
    .map((part) => {
      const text = part.text ?? part.markdown ?? '';
      return text
        ? ({ type: 'text', text: format_chat_text(text) } satisfies ProjectedChatMessagePart)
        : null;
    })
    .filter((part): part is Extract<ProjectedChatMessagePart, { type: 'text' }> => part !== null);

  if (text_parts.length > 0) return text_parts;
  const text = read_item_text(item);
  return text.trim() ? [{ type: 'text' as const, text: format_chat_text(text) }] : [];
}

function project_tool_call_part(
  tool_call: ChatToolCall,
  catalog_nodes_by_key: Map<string, CatalogNode>,
): ProjectedChatToolPart {
  const output = tool_call.output_data ?? tool_call.output_text;
  const output_text = tool_call.output_text;
  const display = tool_call_display(tool_call, catalog_nodes_by_key);
  const created_time = tool_call.created_time ?? tool_call.started_time ?? undefined;
  const input_schema = catalog_nodes_by_key.get(chat_tool_call_node_key(tool_call))?.input_schema;
  const approval_request_id = tool_call.tool_call_metadata?.approval_request_id;
  const approval_labels = tool_call.tool_call_metadata?.approval_labels;
  const approval_display_fields = tool_call.tool_call_metadata?.approval_display_fields;
  const approval_needs_a_person = tool_call.tool_call_metadata?.approval_needs_a_person;

  return {
    type: `tool-${tool_call.tool_name}`,
    toolCallId: tool_call.tool_call_id,
    canonicalId: canonical_tool_call_key(tool_call),
    toolName: tool_call.tool_name,
    ...(created_time ? { createdTime: created_time } : {}),
    state: tool_call.tool_status,
    ...(tool_call.input_data === undefined ? {} : { input: tool_call.input_data }),
    ...(output === undefined ? {} : { output }),
    ...(output_text == null ? {} : { outputText: output_text }),
    ...(tool_call.error_code ? { errorCode: tool_call.error_code } : {}),
    ...(tool_call.error_message ? { errorText: tool_call.error_message } : {}),
    ...(tool_call.duration_ms === undefined || tool_call.duration_ms === null
      ? {}
      : { durationMs: tool_call.duration_ms }),
    ...(input_schema === undefined || input_schema === null ? {} : { inputSchema: input_schema }),
    ...(typeof approval_request_id === 'string' ? { approvalRequestId: approval_request_id } : {}),
    ...(Array.isArray(approval_labels) ? { approvalLabels: approval_labels } : {}),
    ...(Array.isArray(approval_display_fields)
      ? { approvalDisplayFields: approval_display_fields }
      : {}),
    ...(approval_needs_a_person === false ? { approvalNeedsAPerson: false } : {}),
    ...(display ? { display } : {}),
  };
}

function tool_call_display(
  tool_call: ChatToolCall,
  catalog_nodes_by_key: Map<string, CatalogNode>,
): ProjectedChatToolPart['display'] | undefined {
  const input = tool_call.input_data as ToolCallData;
  const output = tool_call.output_data as ToolCallOutput | undefined;
  const output_data = output?.data;
  const display = input.display;
  const node_name = input.node_name ?? output_data?.node_name;
  const catalog_node = catalog_nodes_by_key.get(chat_tool_call_node_key(tool_call));
  const app_id = catalog_node?.app_id;
  const app_name = input.app_name ?? output_data?.app_name ?? catalog_node?.app_key;
  const node_display_name =
    input.node_display_name ?? output_data?.node_display_name ?? catalog_node?.node_display_name;
  const title =
    resolve_system_tool_label(chat_tool_call_node_key(tool_call)) ||
    (display?.title ?? '') ||
    (input.tool_label ?? '') ||
    (node_display_name ?? '') ||
    format_node_name(node_name ?? tool_name_without_version(tool_call.tool_name));
  const subtitle =
    (display?.subtitle ?? '') || (input.app_display_name ?? '') || format_app_name(app_name);

  if (!title && !subtitle && !app_id && !app_name) return undefined;
  return {
    ...(app_id ? { appId: app_id } : {}),
    ...(app_name ? { appName: app_name } : {}),
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
  };
}

function tool_name_without_version(tool_name: string) {
  return tool_name.replace(tool_name_version_suffix_re, '');
}

function format_node_name(value: string | null | undefined) {
  if (!value) return '';
  return value
    .replace(label_word_separator_re, ' ')
    .replace(label_collapse_whitespace_re, ' ')
    .trim()
    .replace(label_word_start_re, (character) => character.toUpperCase());
}

function format_app_name(value: string | null | undefined) {
  if (!value) return undefined;
  return value
    .replace(label_word_separator_re, ' ')
    .replace(label_collapse_whitespace_re, ' ')
    .trim()
    .replace(label_word_start_re, (character) => character.toUpperCase());
}

export function chat_tool_call_node_key(tool_call: ChatToolCall) {
  const input = tool_call.input_data as ToolCallData;
  const output = tool_call.output_data as ToolCallOutput | undefined;
  return (
    input.node_key ?? output?.data?.node_key ?? output?.metadata?.node_key ?? tool_call.tool_name
  );
}

function part_sort_key(part: ProjectedChatMessagePart) {
  if (part.type === 'text' || part.type === 'reasoning') return part.text;
  if (part.type === 'artifact') return part.artifactId;
  if (part.type === 'source') return part.sourceId;
  if (part.type === 'image') return part.name ?? '';
  if (part.type === 'file') return part.fileId ?? part.name ?? '';
  return part.toolCallId;
}

export function is_chat_tool_part(part: ProjectedChatMessagePart): part is ProjectedChatToolPart {
  return part.type.startsWith('tool-');
}

export function chat_tool_part_key(part: ProjectedChatToolPart) {
  return part.canonicalId ?? part.toolCallId;
}

function canonical_tool_call_key(tool_call: ChatToolCall) {
  return read_model_tool_call_id(tool_call) || tool_call.tool_call_id;
}

function is_projected_chat_role(role: string): role is ProjectedChatMessage['role'] {
  return role === 'user' || role === 'assistant' || role === 'system';
}

function visible_assistant_text_set(messages: RunMessage[], run_id: string) {
  return new Set(
    messages
      .filter((message) => message.run_id === run_id)
      .filter((message) => message.message_role === 'assistant')
      .filter(is_user_visible_message)
      .map((message) => comparable_chat_text(read_chat_message_text(message.message_content)))
      .filter(Boolean),
  );
}

function visible_reasoning_text_set(messages: RunMessage[], run_id: string) {
  return new Set(
    messages
      .filter((message) => message.run_id === run_id)
      .filter((message) => message.message_role === 'assistant')
      .flatMap(reasoning_texts_from_message)
      .filter(Boolean),
  );
}

function reasoning_texts_from_message(message: RunMessage) {
  const part_texts = (message.message_content.parts ?? [])
    .filter((part) => part.type === 'thinking')
    .map((part) => comparable_chat_text(part.thinking));
  if (!is_persisted_reasoning_message(message)) return part_texts;
  return [
    comparable_chat_text(read_reasoning_message_text(message.message_content)),
    ...part_texts,
  ];
}

function persisted_tool_call_id_set(messages: RunMessage[]) {
  return new Set(
    messages
      .map((message) => message.tool_call_id)
      .filter((tool_call_id): tool_call_id is string => Boolean(tool_call_id)),
  );
}

function requested_tool_call_ids_from_message(message: RunMessage) {
  if (message.message_role !== 'assistant') return [];

  return (message.message_content.parts ?? [])
    .filter((part) => part.type === 'tool_call')
    .map((part) => part.id)
    .filter((tool_call_id): tool_call_id is string => Boolean(tool_call_id));
}

function tool_calls_by_requested_id(tool_calls: ChatToolCall[]) {
  const tool_calls_by_request_id = new Map<string, ChatToolCall>();

  for (const tool_call of tool_calls) {
    tool_calls_by_request_id.set(tool_call.tool_call_id, tool_call);

    const model_tool_call_id = read_model_tool_call_id(tool_call);
    if (model_tool_call_id) tool_calls_by_request_id.set(model_tool_call_id, tool_call);
  }

  return tool_calls_by_request_id;
}

function compare_run_messages(left: RunMessage, right: RunMessage) {
  return run_message_sequence(left) - run_message_sequence(right);
}

function run_message_sequence(message: RunMessage) {
  return Number(message.message_sequence ?? message.run_message_sequence ?? 0);
}

function run_message_time(message: RunMessage) {
  return read_optional_time(message.created_time);
}

function active_run_tail_sequence(messages: RunMessage[], run_id: string) {
  const run_sequences = messages
    .filter((message) => message.run_id === run_id)
    .map(run_message_sequence)
    .filter((sequence) => sequence > 0);
  return run_sequences.length > 0 ? Math.max(...run_sequences) + 1 : 0;
}

function is_user_visible_message(message: RunMessage) {
  return message.is_user_visible !== false;
}

function is_persisted_reasoning_message(message: RunMessage) {
  if (message.message_role !== 'assistant' || is_user_visible_message(message)) return false;

  const content = message.message_content;
  if (message.message_kind === 'reasoning_summary' || content.type === 'reasoning_summary') {
    return true;
  }

  const source_metadata = message.source_metadata;
  if (source_metadata.visibility === 'debug_trace') return true;

  return source_metadata.has_visible_text === false && message_content_has_thinking_part(content);
}

function message_content_has_thinking_part(content: RunMessage['message_content']) {
  return (content.parts ?? []).some((part) => part.type === 'thinking');
}

function read_reasoning_message_text(content: RunMessage['message_content']) {
  const thinking_text = (content.parts ?? [])
    .map((part) => (part.type === 'thinking' ? part.thinking : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

  return thinking_text || read_chat_message_text(content);
}

function read_chat_message_text(content: RunMessage['message_content']) {
  if (content.text && !has_attachment_part(content)) return content.text;
  return (content.parts ?? []).map(read_message_part_text).filter(Boolean).join('\n');
}

function has_attachment_part(content: RunMessage['message_content']) {
  return (content.parts ?? []).some((part) => part.type === 'file' || part.type === 'image');
}

function read_message_part_text(part: NonNullable<RunMessage['message_content']['parts']>[number]) {
  if (part.type === 'text') return part.text;
  if (part.type === 'image') return '';
  if (part.type === 'file') return '';
  if (part.type === 'tool_result') return tool_result_part_text(part);
  return '';
}

function read_tool_result_message_tool_name(message: RunMessage) {
  const tool_part = (message.message_content.parts ?? []).find(
    (part) => part.type === 'tool_result',
  );
  return tool_part?.type === 'tool_result' ? (tool_part.tool_name ?? '') : '';
}

export function comparable_chat_text(text: string) {
  return format_chat_text(text).replace(/\s+/gu, ' ').trim();
}

function is_visible_reasoning_item(item: ChatThreadProjectionItem) {
  return (item.text ?? read_item_text(item)).trim().length > 0;
}

export function apply_chat_stream_event_to_thread(
  projection: ChatThreadProjection,
  event: ChatStreamEvent,
): ChatThreadProjection {
  if (projection.event_ids[event.event_id]) return projection;

  const item_sequence = next_projection_item_sequence(projection);
  const next_projection: ChatThreadProjection = {
    event_ids: { ...projection.event_ids, [event.event_id]: true },
    items: [...projection.items],
    last_sequence: Math.max(projection.last_sequence ?? 0, event.sequence),
    next_item_sequence: item_sequence,
    ...(projection.active_assistant_text_item_id === undefined
      ? {}
      : { active_assistant_text_item_id: projection.active_assistant_text_item_id }),
    ...(projection.has_internal_item_since_assistant_text === undefined
      ? {}
      : {
          has_internal_item_since_assistant_text: projection.has_internal_item_since_assistant_text,
        }),
    ...(projection.next_assistant_text_index === undefined
      ? {}
      : { next_assistant_text_index: projection.next_assistant_text_index }),
  };
  if (event.event_type === 'item_started' || event.event_type === 'item_completed') {
    const item = projection_item_from_event(next_projection, event.item, item_sequence);
    if (item?.item_type !== 'assistant_message') {
      next_projection.has_internal_item_since_assistant_text = true;
    }
    return sort_projection(upsert_projection_item(next_projection, item));
  }

  if (event.event_type === 'item_updated') {
    if (
      !is_assistant_message_update(
        next_projection,
        event.item_id,
        event.patch as Partial<ChatThreadProjectionItem>,
      )
    ) {
      next_projection.has_internal_item_since_assistant_text = true;
    }
    return sort_projection(
      patch_projection_item(
        next_projection,
        event.item_id,
        event.patch as Partial<ChatThreadProjectionItem>,
      ),
    );
  }

  if (event.event_type === 'item_delta') {
    return sort_projection(apply_item_delta(next_projection, event, item_sequence));
  }

  if (event.event_type === 'item_failed') {
    next_projection.has_internal_item_since_assistant_text = true;
    return sort_projection(
      patch_projection_item(next_projection, event.item_id, {
        item_status: 'failed',
        error: event.error,
      }),
    );
  }

  return next_projection;
}

export function chat_thread_tool_calls(projection: ChatThreadProjection | undefined) {
  return (projection?.items ?? [])
    .filter((item) => item.item_type === 'tool_call')
    .map((item): ChatToolCall => {
      return {
        tool_call_id: item.tool_call_id ?? item.item_id,
        run_id: item.run_id,
        ...(item.parent_item_id === undefined ? {} : { parent_item_id: item.parent_item_id }),
        tool_name: item.tool_name ?? 'tool',
        tool_status:
          item.item_status === 'failed' ? 'failed' : (item.tool_status ?? item.item_status),
        input_data: item.input_data ?? {},
        ...(item.output_data === undefined ? {} : { output_data: item.output_data }),
        ...(item.output_text === undefined ? {} : { output_text: item.output_text }),
        ...(item.output_file_id === undefined ? {} : { output_file_id: item.output_file_id }),
        ...(item.file_ids === undefined ? {} : { file_ids: item.file_ids }),
        ...(item.error?.code ? { error_code: item.error.code } : {}),
        ...(item.error?.message ? { error_message: item.error.message } : {}),
        ...(item.duration_ms === undefined ? {} : { duration_ms: item.duration_ms }),
        item_sequence: item.item_sequence,
        tool_call_metadata: read_live_tool_call_metadata(item),
        created_time: item.created_time,
        started_time: item.created_time ?? null,
        completed_time:
          item.item_status === 'complete' || item.item_status === 'failed'
            ? (item.last_updated_time ?? null)
            : null,
      };
    });
}

export function chat_thread_streaming_text(projection: ChatThreadProjection | undefined) {
  const assistant_item = [...(projection?.items ?? [])]
    .reverse()
    .find((item) => item.item_type === 'assistant_message' && read_item_text(item).trim());
  if (!assistant_item) return '';

  return read_item_text(assistant_item);
}

export function chat_thread_assistant_message_items(projection: ChatThreadProjection | undefined) {
  return (projection?.items ?? []).filter(
    (item) => item.item_type === 'assistant_message' && read_item_text(item).trim(),
  );
}

export function chat_thread_streaming_thinking(projection: ChatThreadProjection | undefined) {
  return chat_thread_thinking_activity(projection)?.text ?? '';
}

export function chat_thread_thinking_activity(
  projection: ChatThreadProjection | undefined,
): ChatThinkingActivity | undefined {
  const thinking_items = chat_thread_thinking_items(projection);
  if (thinking_items.length === 0) return undefined;

  const latest_item = thinking_items[thinking_items.length - 1];
  if (!latest_item) return undefined;

  return {
    is_active: thinking_items.some(is_active_thinking_item),
    item_id: latest_item.item_id,
    run_id: latest_item.run_id,
    text: thinking_items.map((item) => item.text ?? '').join(''),
  };
}

export function chat_thread_thinking_items(projection: ChatThreadProjection | undefined) {
  return (projection?.items ?? []).filter((item) => item.item_type === 'thinking');
}

function is_active_thinking_item(item: ChatThreadProjectionItem) {
  return (
    item.item_type === 'thinking' && !['complete', 'failed', 'cancelled'].includes(item.item_status)
  );
}

export function chat_thread_artifact_items(projection: ChatThreadProjection | undefined) {
  return (projection?.items ?? []).filter(
    (item) => item.item_type === 'artifact' && item.file_id !== undefined,
  );
}

export function chat_thread_source_items(projection: ChatThreadProjection | undefined) {
  return (projection?.items ?? []).filter(
    (item) => item.item_type === 'source' && item.source !== undefined,
  );
}

export function chat_thread_generative_ui_items(projection: ChatThreadProjection | undefined) {
  return (projection?.items ?? []).filter(
    (item) => item.item_type === 'generative_ui' && item.ui_spec !== undefined,
  );
}

export function merge_chat_tool_calls(
  persisted_tool_calls: readonly ToolCall[],
  live_tool_calls: readonly ChatToolCall[],
): ChatToolCall[] {
  const merged: ChatToolCall[] = [];
  const tool_call_index = create_tool_call_index();

  for (const tool_call of persisted_tool_calls) {
    tool_call_index.add(tool_call, merged.length);
    merged.push(tool_call);
  }

  for (const live_tool_call of live_tool_calls) {
    const existing_index = tool_call_index.find(live_tool_call);
    if (existing_index === undefined) {
      tool_call_index.add(live_tool_call, merged.length);
      merged.push(live_tool_call);
      continue;
    }

    const existing = merged[existing_index];
    if (!existing) continue;
    const merged_tool_call = merge_tool_call(existing, live_tool_call);
    merged[existing_index] = merged_tool_call;
    tool_call_index.add(merged_tool_call, existing_index);
  }

  return merged.sort(compare_tool_call_time);
}

function create_tool_call_index() {
  const index_by_tool_call_id = new Map<string, number>();
  const index_by_model_tool_call_id = new Map<string, number>();

  return {
    add(tool_call: ChatToolCall, index: number) {
      if (!index_by_tool_call_id.has(tool_call.tool_call_id)) {
        index_by_tool_call_id.set(tool_call.tool_call_id, index);
      }
      const model_tool_call_id = read_model_tool_call_id(tool_call);
      if (model_tool_call_id && !index_by_model_tool_call_id.has(model_tool_call_id)) {
        index_by_model_tool_call_id.set(model_tool_call_id, index);
      }
    },
    find(tool_call: ChatToolCall) {
      const index_from_tool_call_id = index_by_tool_call_id.get(tool_call.tool_call_id);
      const model_tool_call_id = read_model_tool_call_id(tool_call);
      const index_from_model_tool_call_id = model_tool_call_id
        ? index_by_model_tool_call_id.get(model_tool_call_id)
        : undefined;

      if (index_from_tool_call_id === undefined) return index_from_model_tool_call_id;
      if (index_from_model_tool_call_id === undefined) return index_from_tool_call_id;
      return Math.min(index_from_tool_call_id, index_from_model_tool_call_id);
    },
  };
}

function upsert_projection_item(
  projection: ChatThreadProjection,
  item: ChatThreadProjectionItem | undefined,
) {
  if (!item) return projection;

  const existing_index = projection.items.findIndex(
    (candidate) => candidate.item_id === item.item_id,
  );
  if (existing_index === -1) {
    projection.items.push(item);
    return projection;
  }

  const existing = projection.items[existing_index];
  if (!existing) return projection;
  projection.items[existing_index] = {
    ...existing,
    ...item,
    ...(should_preserve_existing_lifecycle(existing, item)
      ? {
          item_sequence: existing.item_sequence,
          ...(existing.created_time === undefined ? {} : { created_time: existing.created_time }),
        }
      : {}),
    ...(should_preserve_existing_parts(existing, item) ? { parts: existing.parts } : {}),
    ...(should_preserve_existing_text(existing, item) ? { text: existing.text } : {}),
    ...(item.input_data === undefined && existing.input_data !== undefined
      ? { input_data: existing.input_data }
      : {}),
    ...(should_preserve_existing_output(existing, item)
      ? { output_data: existing.output_data }
      : {}),
    ...(item.output_text === undefined && existing.output_text !== undefined
      ? { output_text: existing.output_text }
      : {}),
    ...(item.output_file_id === undefined && existing.output_file_id !== undefined
      ? { output_file_id: existing.output_file_id }
      : {}),
    ...(item.file_ids === undefined && existing.file_ids !== undefined
      ? { file_ids: existing.file_ids }
      : {}),
    ...(item.ui_spec === undefined && existing.ui_spec !== undefined
      ? { ui_spec: existing.ui_spec }
      : {}),
    ...(item.content === undefined && existing.content !== undefined
      ? { content: existing.content }
      : {}),
    ...(item.content_preview === undefined && existing.content_preview !== undefined
      ? { content_preview: existing.content_preview }
      : {}),
    ...(item.title === undefined && existing.title !== undefined ? { title: existing.title } : {}),
    ...(item.file_purpose === undefined && existing.file_purpose !== undefined
      ? { file_purpose: existing.file_purpose }
      : {}),
  };
  return projection;
}

function should_preserve_existing_lifecycle(
  existing: ChatThreadProjectionItem,
  item: ChatThreadProjectionItem,
) {
  return existing.item_type === item.item_type;
}

function should_preserve_existing_parts(
  existing: ChatThreadProjectionItem,
  item: ChatThreadProjectionItem,
) {
  if (existing.parts === undefined) return false;
  if (item.parts === undefined) return true;
  return (
    item.item_type === 'assistant_message' &&
    read_item_text(existing).trim().length > 0 &&
    read_item_text(item).trim().length === 0
  );
}

function should_preserve_existing_output(
  existing: ChatThreadProjectionItem,
  item: ChatThreadProjectionItem,
) {
  if (existing.output_data === undefined || existing.output_data === null) return false;
  return item.output_data === undefined || item.output_data === null;
}

function should_preserve_existing_text(
  existing: ChatThreadProjectionItem,
  item: ChatThreadProjectionItem,
) {
  if (typeof existing.text !== 'string' || !existing.text.trim()) return false;
  if (item.text === undefined) return true;
  return item.item_type === 'thinking' && item.text.trim().length === 0;
}

function patch_projection_item(
  projection: ChatThreadProjection,
  item_id: string,
  patch: Partial<ChatThreadProjectionItem>,
) {
  if (!item_id || Object.keys(patch).length === 0) return projection;

  const existing_index = projection.items.findIndex((candidate) => candidate.item_id === item_id);
  if (existing_index === -1) {
    projection.items.push(normalize_placeholder_item(item_id, patch));
    return projection;
  }

  const existing = projection.items[existing_index];
  if (!existing) return projection;
  projection.items[existing_index] = { ...existing, ...patch };
  return projection;
}

function apply_item_delta(
  projection: ChatThreadProjection,
  event: ChatStreamEvent & {
    event_type: 'item_delta';
    item_id: string;
    delta: ChatItemDelta;
  },
  item_sequence: number,
) {
  const delta = event.delta;
  const item_id = delta_item_id(projection, event.item_id, delta);
  if (!item_id) return projection;
  if (delta.delta_type !== 'text_delta') {
    projection.has_internal_item_since_assistant_text = true;
  }

  let existing_index = projection.items.findIndex((candidate) => candidate.item_id === item_id);
  if (existing_index === -1) {
    projection.items.push(placeholder_item_from_delta(event, item_id, delta, item_sequence));
    existing_index = projection.items.length - 1;
  }

  const existing = projection.items[existing_index];
  if (!existing) return projection;

  if (delta.delta_type === 'text_delta') {
    projection.items[existing_index] = append_text_delta(existing, delta.text);
  } else if (delta.delta_type === 'markdown_delta') {
    projection.items[existing_index] = append_text_delta(existing, delta.markdown);
  } else if (delta.delta_type === 'thinking_delta') {
    projection.items[existing_index] = {
      ...existing,
      text: `${existing.text ?? ''}${delta.text}`,
    };
  } else if (delta.delta_type === 'tool_output_delta') {
    projection.items[existing_index] = {
      ...existing,
      output_data: delta.output_delta ?? existing.output_data,
      output_text: `${existing.output_text ?? ''}${delta.output_text_delta ?? ''}`,
    };
  } else if (delta.delta_type === 'tool_input_delta') {
    projection.items[existing_index] = {
      ...existing,
      input_data: delta.input_delta ?? existing.input_data,
    };
  } else if (delta.delta_type === 'generative_ui_delta') {
    projection.items[existing_index] = apply_generative_ui_delta(existing, delta.ui_spec_delta);
  } else if (delta.delta_type === 'artifact_content_delta') {
    projection.items[existing_index] = apply_artifact_content_delta(
      existing,
      read_artifact_content_delta(delta.content_delta),
    );
  }

  return projection;
}

function append_text_delta(item: ChatThreadProjectionItem, text: string): ChatThreadProjectionItem {
  const parts = item.parts ?? [{ type: 'text', text: '' }];
  const first_text_part_index = parts.findIndex((part) => part.type === 'text');
  if (first_text_part_index === -1) {
    return { ...item, parts: [...parts, { type: 'text', text }] };
  }

  return {
    ...item,
    parts: parts.map((part, index) =>
      index === first_text_part_index ? { ...part, text: `${part.text ?? ''}${text}` } : part,
    ),
  };
}

function placeholder_item_from_delta(
  event: ChatStreamEvent,
  item_id: string,
  delta: ChatItemDelta,
  item_sequence: number,
): ChatThreadProjectionItem {
  if (delta.delta_type === 'thinking_delta') {
    return {
      item_id,
      run_id: event.run_id,
      item_type: 'thinking',
      item_status: 'streaming',
      item_sequence,
      text: '',
      created_time: event.occurred_time,
      last_updated_time: event.occurred_time,
    };
  }

  if (delta.delta_type === 'tool_output_delta' || delta.delta_type === 'tool_input_delta') {
    return {
      item_id,
      run_id: event.run_id,
      item_type: 'tool_call',
      item_status: 'streaming',
      item_sequence,
      tool_call_id: item_id,
      tool_name: 'tool',
      tool_status: 'running',
      input_data: {},
      created_time: event.occurred_time,
      last_updated_time: event.occurred_time,
    };
  }

  if (delta.delta_type === 'generative_ui_delta') {
    return {
      item_id,
      run_id: event.run_id,
      item_type: 'generative_ui',
      item_status: 'streaming',
      item_sequence,
      renderer_key: 'json-render',
      ui_spec_format: 'json-render',
      created_time: event.occurred_time,
      last_updated_time: event.occurred_time,
    };
  }

  if (delta.delta_type === 'artifact_content_delta') {
    const file_id = delta.file_id || item_id;
    return {
      item_id,
      run_id: event.run_id,
      item_type: 'artifact',
      item_status: 'streaming',
      item_sequence,
      file_id,
      file_purpose: 'text',
      title: 'Artifact',
      content: '',
      content_preview: '',
      created_time: event.occurred_time,
      last_updated_time: event.occurred_time,
    };
  }

  return {
    item_id,
    run_id: event.run_id,
    item_type: 'assistant_message',
    item_status: 'streaming',
    item_sequence,
    parts: [{ type: 'text', text: '' }],
    created_time: event.occurred_time,
    last_updated_time: event.occurred_time,
  };
}

function normalize_placeholder_item(
  item_id: string,
  patch: Partial<ChatThreadProjectionItem>,
): ChatThreadProjectionItem {
  return {
    ...patch,
    item_id,
    run_id: patch.run_id ?? '',
    item_type: patch.item_type || 'assistant_message',
    item_status: patch.item_status || 'streaming',
    item_sequence: patch.item_sequence ?? 0,
  };
}

function projection_item_from_event(
  projection: ChatThreadProjection,
  value: ChatThreadItem,
  item_sequence: number,
) {
  const item = value as ChatThreadProjectionItem;
  const sequenced_item = { ...item, item_sequence };
  if (sequenced_item.item_type !== 'assistant_message') return sequenced_item;
  return assistant_message_projection_item(projection, sequenced_item);
}

function next_projection_item_sequence(projection: ChatThreadProjection) {
  return (projection.next_item_sequence ?? 0) + 1;
}

function is_assistant_message_update(
  projection: ChatThreadProjection,
  item_id: string,
  patch: Partial<ChatThreadProjectionItem>,
) {
  const existing = projection.items.find((candidate) => candidate.item_id === item_id);
  if (existing) return existing.item_type === 'assistant_message';
  return 'parts' in patch && Array.isArray(patch.parts);
}

function delta_item_id(projection: ChatThreadProjection, item_id: string, delta: ChatItemDelta) {
  if (delta.delta_type !== 'text_delta' && delta.delta_type !== 'markdown_delta') return item_id;

  const had_active_assistant_text = Boolean(projection.active_assistant_text_item_id);
  if (!projection.active_assistant_text_item_id) {
    projection.active_assistant_text_item_id = item_id;
    projection.next_assistant_text_index = next_assistant_text_index(item_id);
    projection.has_internal_item_since_assistant_text = false;
  }

  if (had_active_assistant_text && projection.has_internal_item_since_assistant_text) {
    projection.active_assistant_text_item_id = assistant_text_segment_item_id(
      item_id,
      projection.next_assistant_text_index ?? next_assistant_text_index(item_id),
    );
    projection.next_assistant_text_index = (projection.next_assistant_text_index ?? 1) + 1;
    projection.has_internal_item_since_assistant_text = false;
  }

  return projection.active_assistant_text_item_id;
}

function assistant_message_projection_item(
  projection: ChatThreadProjection,
  item: ChatThreadProjectionItem,
) {
  const existing = projection.items.find((candidate) => candidate.item_id === item.item_id);
  const item_id = should_start_new_assistant_projection_item(projection, existing, item)
    ? next_assistant_projection_item_id(projection, item.item_id)
    : item.item_id;

  track_active_assistant_projection_item(projection, item_id);
  return { ...item, item_id };
}

function should_start_new_assistant_projection_item(
  projection: ChatThreadProjection,
  existing: ChatThreadProjectionItem | undefined,
  item: ChatThreadProjectionItem,
) {
  if (!existing) return false;
  if (is_distinct_persisted_assistant_message(existing, item)) return true;
  if (!projection.has_internal_item_since_assistant_text) return false;

  const existing_text = read_item_text(existing).trim();
  const item_text = read_item_text(item).trim();
  if (!existing_text) return false;
  if (!item_text) return item.item_status === 'streaming';
  return existing_text !== item_text;
}

function is_distinct_persisted_assistant_message(
  existing: ChatThreadProjectionItem,
  item: ChatThreadProjectionItem,
) {
  return Boolean(existing.message_id && item.message_id && existing.message_id !== item.message_id);
}

function next_assistant_projection_item_id(projection: ChatThreadProjection, item_id: string) {
  const next_index = projection.next_assistant_text_index ?? next_assistant_text_index(item_id);
  const next_item_id = assistant_text_segment_item_id(item_id, next_index);
  projection.next_assistant_text_index = next_index + 1;
  return next_item_id;
}

function track_active_assistant_projection_item(projection: ChatThreadProjection, item_id: string) {
  if (!projection.active_assistant_text_item_id) {
    projection.next_assistant_text_index = next_assistant_text_index(item_id);
  }
  projection.active_assistant_text_item_id = item_id;
  projection.has_internal_item_since_assistant_text = false;
}

function next_assistant_text_index(item_id: string) {
  const match = assistant_segment_index_re.exec(item_id);
  return match ? Number(match[1]) + 1 : 1;
}

function assistant_text_segment_item_id(item_id: string, index: number) {
  const match = assistant_segment_prefix_re.exec(item_id);
  if (match?.[1]) return `${match[1]}${index}`;
  return `${item_id}:segment:${index}`;
}

function sort_projection(projection: ChatThreadProjection) {
  return {
    ...projection,
    items: [...projection.items].sort(
      (left, right) =>
        left.item_sequence - right.item_sequence || left.item_id.localeCompare(right.item_id),
    ),
  };
}

export function read_item_text(item: ChatThreadProjectionItem) {
  return (item.parts ?? [])
    .map((part) => {
      if (typeof part.text === 'string') return part.text;
      if (typeof part.markdown === 'string') return part.markdown;
      return '';
    })
    .join('');
}

function merge_tool_call(existing: ChatToolCall, live_tool_call: ChatToolCall): ChatToolCall {
  const existing_is_persisted = !existing.tool_call_id.startsWith('stream:');
  const base = existing_is_persisted ? existing : live_tool_call;
  const overlay = existing_is_persisted ? live_tool_call : existing;
  const output_data = base.output_data ?? overlay.output_data;
  const output_text = base.output_text ?? overlay.output_text;
  const output_file_id = base.output_file_id ?? overlay.output_file_id;
  const file_ids = merge_artifact_ids(base.file_ids, overlay.file_ids);
  const error_message = base.error_message ?? overlay.error_message;
  const duration_ms = base.duration_ms ?? overlay.duration_ms;
  const started_time = base.started_time ?? overlay.started_time;
  const completed_time = base.completed_time ?? overlay.completed_time;
  const created_time = base.created_time ?? overlay.created_time;
  const item_sequence = live_tool_call.item_sequence ?? existing.item_sequence;

  return {
    ...base,
    tool_status: more_complete_tool_status(base.tool_status, overlay.tool_status),
    input_data: is_empty_object(base.input_data) ? overlay.input_data : base.input_data,
    ...(item_sequence === undefined ? {} : { item_sequence }),
    ...(output_data === undefined ? {} : { output_data }),
    ...(output_text === undefined ? {} : { output_text }),
    ...(output_file_id === undefined ? {} : { output_file_id }),
    ...(file_ids.length === 0 ? {} : { file_ids }),
    ...(error_message === undefined ? {} : { error_message }),
    ...(duration_ms === undefined ? {} : { duration_ms }),
    ...(created_time === undefined ? {} : { created_time }),
    tool_call_metadata: {
      ...(overlay.tool_call_metadata ?? {}),
      ...(base.tool_call_metadata ?? {}),
    },
    ...(started_time === undefined ? {} : { started_time }),
    ...(completed_time === undefined ? {} : { completed_time }),
  };
}

function merge_artifact_ids(left: string[] | undefined, right: string[] | undefined) {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function more_complete_tool_status(left: string, right: string) {
  const left_rank = tool_status_rank(left);
  const right_rank = tool_status_rank(right);
  return right_rank > left_rank ? right : left;
}

function tool_status_rank(status: string) {
  if (status === 'awaiting_approval') return 5;
  if (is_terminal_tool_status(status)) return 4;
  if (status === 'executing' || status === 'running') return 2;
  if (status === 'pending') return 1;
  return 0;
}

function compare_tool_call_time(left: ChatToolCall, right: ChatToolCall) {
  const sequence_delta = compare_optional_number(left.item_sequence, right.item_sequence);
  if (sequence_delta !== undefined && sequence_delta !== 0) return sequence_delta;

  return (
    read_time(left.created_time ?? left.started_time) -
      read_time(right.created_time ?? right.started_time) ||
    left.tool_call_id.localeCompare(right.tool_call_id)
  );
}

function compare_optional_number(left: number | undefined, right: number | undefined) {
  if (left === undefined || right === undefined) return undefined;
  return left - right;
}

function read_time(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function read_optional_time(value: string | null | undefined) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function read_model_tool_call_id(tool_call: ChatToolCall) {
  const metadata = tool_call.tool_call_metadata;
  return read_model_call_key(metadata?.runtime_tool_call_id || metadata?.model_tool_call_id || '');
}

// Some providers hand back a compound id -- `call_abc|fc_0123…` -- where the runtime only ever
// knew the first part. Two views of one call that disagree on its id become two rows in the chat,
// and the one the engine wrote (a bare "running") wins over the one our own ledger wrote. Matching
// on the leading segment is what keeps them one call.
function read_model_call_key(model_tool_call_id: string) {
  const [leading = ''] = model_tool_call_id.split('|');
  return leading;
}

function is_terminal_tool_status(status: string) {
  return ['completed', 'failed', 'blocked', 'timed_out', 'cancelled', 'denied'].includes(status);
}

function is_empty_object(value: unknown) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length === 0);
}

function apply_generative_ui_delta(
  item: ChatThreadProjectionItem,
  ui_spec_delta: unknown,
): ChatThreadProjectionItem {
  const current_spec = item.ui_spec as Record<string, unknown> | undefined;
  const next_spec = ui_spec_delta as Record<string, unknown>;
  return {
    ...item,
    renderer_key: item.renderer_key ?? 'json-render',
    ui_spec_format: item.ui_spec_format ?? 'json-render',
    ui_spec:
      current_spec && Object.keys(current_spec).length > 0
        ? { ...current_spec, ...next_spec }
        : ui_spec_delta,
  };
}

function apply_artifact_content_delta(
  item: ChatThreadProjectionItem,
  content_delta: string,
): ChatThreadProjectionItem {
  const content = `${item.content ?? item.content_preview ?? ''}${content_delta}`;
  return {
    ...item,
    file_purpose: item.file_purpose ?? 'text',
    title: item.title ?? 'Artifact',
    content,
    content_preview: content.slice(0, 6000),
  };
}

function read_artifact_content_delta(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object' || Array.isArray(value)) return stringify_delta_value(value);

  const record = value as {
    text?: string;
    markdown?: string;
    code?: string;
    delta?: string;
    data?: string;
  };
  if (typeof record.text === 'string') return record.text;
  if (typeof record.markdown === 'string') return record.markdown;
  if (typeof record.code === 'string') return record.code;
  if (typeof record.delta === 'string') return record.delta;
  if (typeof record.data === 'string') return record.data;
  return stringify_delta_value(value);
}

function stringify_delta_value(value: unknown) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}
