import type { ChatStreamEvent } from '@runtime-platform/chat_stream/chat_stream_events';

export const wire_json_char_cap = 20_000;
const wire_preview_char_cap = 2_000;
const wire_label_char_cap = 2_000;
const wire_artifact_content_char_cap = 100_000;

const tool_input_label_keys = [
  'node_key',
  'node_name',
  'node_display_name',
  'app_id',
  'app_name',
  'app_display_name',
  'tool_label',
  'iconUrl',
  'icon_url',
  'display',
  'path',
  'file_path',
  'file_name',
  'pattern',
  'command',
  'port',
  'query',
  'url',
] as const;

const tool_output_label_keys = ['data', 'metadata', 'type'] as const;

const wire_display_char_cap = 8_000;

const brain_reader_tool_names = new Set(['runtime-search_documents', 'runtime-read_document']);
const tool_name_version_suffix = /-\d+$/u;

function is_brain_reader_tool(tool_name: unknown) {
  if (typeof tool_name !== 'string') return false;
  return brain_reader_tool_names.has(tool_name.replace(tool_name_version_suffix, ''));
}

function plain_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function read_tool_display(value: unknown) {
  if (!plain_record(value)) return undefined;
  const data = Reflect.get(value, 'data');
  const display = plain_record(data) ? Reflect.get(data, 'display') : Reflect.get(value, 'display');
  return plain_record(display) ? display : undefined;
}

function brain_reader_wire_output(tool_name: unknown, value: unknown) {
  if (!is_brain_reader_tool(tool_name)) return undefined;
  const display = read_tool_display(value);
  if (!display) return undefined;
  const summary = Reflect.get(display, 'summary');
  return {
    wire_truncated: true,
    original_chars: serialize_for_measurement(value)?.length ?? 0,
    preview: typeof summary === 'string' ? summary : '',
    data: { display },
  } satisfies WireTruncatedValue;
}

type WireTruncatedValue = {
  wire_truncated: true;
  original_chars: number;
  preview: string;
} & Record<string, unknown>;

type ChatItemPayload = {
  content?: string;
  tool_name?: string;
  input_data?: unknown;
  output_data?: unknown;
  output_text?: string;
};

type StoredMessageContent = {
  text?: string;
  parts?: StoredMessagePart[];
  data?: StoredMessageData;
};
type StoredMessageData = {
  tool_name?: string;
  result?: StoredToolResult;
  content?: StoredMessagePart[];
};
type StoredToolResult = { content_json?: unknown; content_text?: string };
type StoredMessagePart = {
  result?: StoredToolResult;
  tool_name?: string;
  type?: string;
};

export function public_session_message<
  T extends {
    message_content: unknown;
    content_text?: unknown;
    content_json?: unknown;
    provider_item_id?: unknown;
    provider_call_id?: unknown;
    token_count?: unknown;
    metadata?: unknown;
    workspace_id?: unknown;
    created_by?: unknown;
    last_updated_time?: unknown;
    last_updated_by?: unknown;
  },
>(message: T) {
  const {
    content_text: _content_text,
    content_json: _content_json,
    provider_item_id: _provider_item_id,
    provider_call_id: _provider_call_id,
    token_count: _token_count,
    metadata: _metadata,
    workspace_id: _workspace_id,
    created_by: _created_by,
    last_updated_time: _last_updated_time,
    last_updated_by: _last_updated_by,
    ...kept
  } = message;

  return { ...kept, message_content: bounded_message_content(message.message_content) };
}

const skills_path_pattern = /(?:^|[\s"'`=(:,/])(?:\.\/)?skills\/([A-Za-z0-9._-]+)/;
const skill_content_hidden = '[skill content hidden]';
const save_procedure_rule_tool = 'runtime-save_procedure_rule-1';
const skill_safe_input_keys = new Set(['path', 'file_path', 'procedure', 'rule_key', 'node_key']);

export function redact_skill_tool_call<
  T extends {
    tool_name?: unknown;
    input_data: unknown;
    output_data: unknown;
    output_text: string | null;
  },
>(tool_call: T): T {
  const touches_skills =
    tool_call.tool_name === save_procedure_rule_tool ||
    first_skill_name(tool_call.input_data) !== undefined ||
    first_skill_name(tool_call.output_data) !== undefined;
  if (!touches_skills) return tool_call;

  const skill_name =
    first_skill_name(tool_call.input_data) ??
    first_skill_name(tool_call.output_data) ??
    procedure_field(tool_call.input_data) ??
    'a skill';
  return {
    ...tool_call,
    input_data: keep_identifying_fields(tool_call.input_data),
    output_data: { skill: skill_name, note: skill_content_hidden },
    output_text: `Skill "${skill_name}" — content hidden`,
  };
}

function first_skill_name(value: unknown): string | undefined {
  if (typeof value === 'string') return skills_path_pattern.exec(value)?.[1];
  if (!value || typeof value !== 'object') return undefined;
  for (const entry of Object.values(value)) {
    const found = first_skill_name(entry);
    if (found) return found;
  }
  return undefined;
}

function procedure_field(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const procedure = (value as Record<string, unknown>).procedure;
  return typeof procedure === 'string' ? procedure : undefined;
}

function keep_identifying_fields(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return skill_content_hidden;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      skill_safe_input_keys.has(key) && typeof entry === 'string' ? entry : skill_content_hidden,
    ]),
  );
}

export function public_tool_call<
  T extends {
    input_data: unknown;
    output_data: unknown;
    output_text: string | null;
    tool_name?: unknown;
    workspace_id: unknown;
    agent_id: unknown;
    node_id: unknown;
    connection_id: unknown;
    node_version: unknown;
    risk_class: unknown;
    approval_mode: unknown;
    error_code: unknown;
    finished_time: unknown;
    metadata: unknown;
    created_by: unknown;
    last_updated_time: unknown;
    last_updated_by: unknown;
  },
>(raw_tool_call: T) {
  const tool_call = redact_skill_tool_call(raw_tool_call);
  const {
    workspace_id: _workspace_id,
    agent_id: _agent_id,
    node_id: _node_id,
    connection_id: _connection_id,
    node_version: _node_version,
    risk_class: _risk_class,
    approval_mode: _approval_mode,
    finished_time: _finished_time,
    metadata: _metadata,
    created_by: _created_by,
    last_updated_time: _last_updated_time,
    last_updated_by: _last_updated_by,
    ...kept
  } = tool_call;

  const brain = brain_reader_wire_output(tool_call.tool_name, tool_call.output_data);
  return {
    ...kept,
    input_data: bounded_wire_value(tool_call.input_data, tool_input_label_keys),
    output_data: brain ?? bounded_tool_output(tool_call.output_data),
    output_text: brain ? brain.preview : bounded_text(tool_call.output_text, wire_json_char_cap),
  };
}

export function public_persisted_chat_event(event: ChatStreamEvent): ChatStreamEvent {
  if (event.event_type === 'item_started' || event.event_type === 'item_completed') {
    return { ...event, item: bounded_chat_item(event.item) } as ChatStreamEvent;
  }
  if (event.event_type === 'item_updated') {
    return { ...event, patch: bounded_chat_item(event.patch) } as ChatStreamEvent;
  }
  return event;
}

function bounded_chat_item<T>(item: T): T {
  const chat_item = item as T & ChatItemPayload;
  const brain = brain_reader_wire_output(chat_item.tool_name, chat_item.output_data);

  return {
    ...chat_item,
    ...('input_data' in chat_item
      ? { input_data: bounded_wire_value(chat_item.input_data, tool_input_label_keys) }
      : {}),
    ...('output_data' in chat_item
      ? { output_data: brain ?? bounded_tool_output(chat_item.output_data) }
      : {}),
    ...('output_text' in chat_item && typeof chat_item.output_text === 'string'
      ? {
          output_text: brain
            ? brain.preview
            : bounded_text(chat_item.output_text, wire_json_char_cap),
        }
      : {}),
    ...('content' in chat_item && typeof chat_item.content === 'string'
      ? { content: bounded_text(chat_item.content, wire_artifact_content_char_cap) }
      : {}),
  } as T;
}

function bounded_message_content(content: unknown) {
  const message_content = content as StoredMessageContent;
  if (!Array.isArray(message_content.parts)) return content;

  const data = plain_record(message_content.data) ? message_content.data : undefined;
  const first = message_content.parts.at(0);
  const brain = brain_reader_wire_output(
    data?.tool_name ?? first?.tool_name,
    (data?.result ?? first?.result)?.content_json,
  );

  return {
    ...message_content,
    ...(brain && typeof message_content.text === 'string' ? { text: brain.preview } : {}),
    parts: message_content.parts.map(bounded_message_part),
    ...(data ? { data: bounded_message_data(data) } : {}),
  };
}

function bounded_message_data(data: StoredMessageData) {
  return {
    ...data,
    ...(data.result ? { result: bounded_tool_result(data.tool_name, data.result) } : {}),
    ...(Array.isArray(data.content) ? { content: data.content.map(bounded_message_part) } : {}),
  };
}

function bounded_message_part(part: StoredMessagePart) {
  if (part.type !== 'tool_result' || !part.result) return part;

  return { ...part, result: bounded_tool_result(part.tool_name, part.result) };
}

function bounded_tool_result(tool_name: string | undefined, result: StoredToolResult) {
  const brain = brain_reader_wire_output(tool_name, result.content_json);
  return {
    ...result,
    ...(typeof result.content_text === 'string'
      ? {
          content_text: brain
            ? brain.preview
            : bounded_text(result.content_text, wire_json_char_cap),
        }
      : {}),
    ...('content_json' in result
      ? { content_json: brain ?? bounded_wire_value(result.content_json, []) }
      : {}),
  };
}

function bounded_tool_output(value: unknown) {
  if (is_connection_setup(value)) return value;
  return bounded_wire_value(value, tool_output_label_keys);
}

function is_connection_setup(value: unknown) {
  if (typeof value !== 'object' || value === null) return false;
  const data = Reflect.get(value, 'data');
  return (
    Reflect.get(value, 'type') === 'connection_setup' ||
    (typeof data === 'object' && data !== null && Reflect.get(data, 'type') === 'connection_setup')
  );
}

export function bounded_wire_value(value: unknown, label_keys: readonly string[]): unknown {
  if (value === null || value === undefined) return value;
  const serialized = serialize_for_measurement(value);
  if (serialized === null) return { wire_truncated: true, original_chars: 0, preview: '' };
  if (serialized.length <= wire_json_char_cap) return value;

  const record = plain_record(value) ? value : null;
  const labels = record ? preserved_wire_labels(record, label_keys) : {};
  return {
    wire_truncated: true,
    original_chars: serialized.length,
    preview: serialized.slice(0, wire_preview_char_cap),
    ...labels,
    ...('data' in labels ? {} : preserved_wire_display(record)),
  } satisfies WireTruncatedValue;
}

function preserved_wire_display(record: object | null) {
  const display = read_tool_display(record);
  if (!display) return {};
  const serialized = serialize_for_measurement(display);
  if (serialized === null || serialized.length > wire_display_char_cap) return {};
  return { data: { display } };
}

function preserved_wire_labels(record: object, keys: readonly string[]) {
  return Object.fromEntries(
    keys.flatMap((key) => {
      if (!(key in record)) return [];
      const value = Reflect.get(record, key);
      const serialized = serialize_for_measurement(value);
      if (serialized === null || serialized.length > wire_label_char_cap) return [];
      return [[key, value] as const];
    }),
  );
}

function bounded_text(value: string | null | undefined, cap: number) {
  if (value === null || value === undefined) return value;
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}\n[truncated ${value.length - cap} chars — full payload available in the inspector]`;
}

function serialize_for_measurement(value: unknown) {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}
