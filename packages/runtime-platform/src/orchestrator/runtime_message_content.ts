import type {
  RuntimeAgentMessagePart,
  RuntimeFileMessagePart,
} from '@agent-core/messages/runtime_message';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { MessageContent, MessageContentPart } from '@coworker/shared';

export function runtime_parts_to_message_content(parts: RuntimeAgentMessagePart[]): MessageContent {
  const text = runtime_message_parts_text(parts);
  const storable_parts = parts.flatMap(runtime_part_to_storable_part);
  const data_parts = parts.filter(needs_raw_data_storage);
  const has_non_text_part = storable_parts.some((part) => part.type !== 'text');

  return {
    type: has_non_text_part ? 'multimodal' : 'text',
    ...(text ? { text } : {}),
    ...(storable_parts.length === 0 ? {} : { parts: storable_parts }),
    ...(data_parts.length === 0 ? {} : { data: { content: data_parts } }),
  };
}

export function message_content_to_runtime_parts(
  content: MessageContent,
): RuntimeAgentMessagePart[] {
  const data_parts = data_content_to_runtime_parts(content);

  if (content.parts && content.parts.length > 0) {
    return [
      ...content.parts.map(shared_part_to_runtime_part),
      ...data_parts.filter((part) => part.type === 'json'),
    ];
  }

  if (data_parts.length > 0) return data_parts;

  const text = content.text ?? (content.data === undefined ? '' : JSON.stringify(content.data));
  return text ? [{ type: 'text', text }] : [];
}

export function runtime_message_parts_text(parts: readonly RuntimeAgentMessagePart[]) {
  return parts.map(runtime_message_part_text).filter(Boolean).join('\n').trim();
}

function runtime_message_part_text(part: RuntimeAgentMessagePart) {
  if (part.type === 'text') return part.text;
  if (part.type === 'json') return JSON.stringify(part.json);
  if (part.type === 'file') return part.text ?? part.name ?? part.path ?? part.url ?? '';
  if (part.type === 'thinking') return part.redacted ? '' : part.thinking;
  if (part.type === 'tool_result') return runtime_tool_result_text(part.result);
  return '';
}

function runtime_part_to_storable_part(part: RuntimeAgentMessagePart): MessageContentPart[] {
  if (part.type === 'text') return [text_part_to_storable_part(part)];
  if (part.type === 'image') return [image_part_to_storable_part(part)];
  if (part.type === 'file') return [file_part_to_storable_part(part)];
  if (part.type === 'thinking') return [thinking_part_to_storable_part(part)];
  if (part.type === 'tool_call') return [tool_call_part_to_storable_part(part)];
  if (part.type === 'tool_result') return [tool_result_part_to_storable_part(part)];
  return [];
}

function needs_raw_data_storage(part: RuntimeAgentMessagePart) {
  return part.type === 'json';
}

function text_part_to_storable_part(part: Extract<RuntimeAgentMessagePart, { type: 'text' }>) {
  return {
    type: 'text' as const,
    text: part.text,
    ...(part.text_signature === undefined ? {} : { text_signature: part.text_signature }),
    ...parsed_signature_field('text_signature_data', part.text_signature),
  };
}

function image_part_to_storable_part(part: Extract<RuntimeAgentMessagePart, { type: 'image' }>) {
  return {
    type: 'image' as const,
    data: part.data,
    mime_type: part.mime_type,
    ...(part.detail === undefined ? {} : { detail: part.detail }),
    ...(part.source === undefined ? {} : { source: part.source }),
  };
}

function file_part_to_storable_part(part: RuntimeFileMessagePart) {
  return {
    type: 'file' as const,
    ...(part.file_id === undefined ? {} : { file_id: part.file_id }),
    ...(part.path === undefined ? {} : { path: part.path }),
    ...(part.url === undefined ? {} : { url: part.url }),
    ...(part.name === undefined ? {} : { name: part.name }),
    ...(part.mime_type === undefined ? {} : { mime_type: part.mime_type }),
    ...(part.text === undefined ? {} : { text: part.text }),
  };
}

function thinking_part_to_storable_part(
  part: Extract<RuntimeAgentMessagePart, { type: 'thinking' }>,
) {
  return {
    type: 'thinking' as const,
    thinking: part.thinking,
    ...(part.signature === undefined ? {} : { signature: part.signature }),
    ...parsed_signature_field('signature_data', part.signature),
    ...(part.redacted === undefined ? {} : { redacted: part.redacted }),
  };
}

function tool_call_part_to_storable_part(
  part: Extract<RuntimeAgentMessagePart, { type: 'tool_call' }>,
) {
  return {
    type: 'tool_call' as const,
    id: part.id,
    name: part.name,
    arguments: part.arguments,
    ...(part.thought_signature === undefined ? {} : { thought_signature: part.thought_signature }),
  };
}

function tool_result_part_to_storable_part(
  part: Extract<RuntimeAgentMessagePart, { type: 'tool_result' }>,
) {
  return {
    type: 'tool_result' as const,
    ...(part.tool_call_id === undefined ? {} : { tool_call_id: part.tool_call_id }),
    ...(part.tool_name === undefined ? {} : { tool_name: part.tool_name }),
    result: part.result,
  };
}

function shared_part_to_runtime_part(part: MessageContentPart): RuntimeAgentMessagePart {
  if (part.type === 'image') return shared_image_part_to_runtime_part(part);
  if (part.type === 'file') return shared_file_part_to_runtime_part(part);
  if (part.type === 'thinking') return shared_thinking_part_to_runtime_part(part);
  if (part.type === 'tool_call') return shared_tool_call_part_to_runtime_part(part);
  if (part.type === 'tool_result') return shared_tool_result_part_to_runtime_part(part);

  return {
    type: 'text',
    text: part.text,
    ...(part.text_signature === undefined ? {} : { text_signature: part.text_signature }),
  };
}

function shared_image_part_to_runtime_part(
  part: Extract<MessageContentPart, { type: 'image' }>,
): RuntimeAgentMessagePart {
  return {
    type: 'image',
    data: part.data,
    mime_type: part.mime_type,
    ...(part.detail === undefined ? {} : { detail: part.detail }),
    ...(part.source === undefined ? {} : { source: part.source }),
  };
}

function shared_file_part_to_runtime_part(
  part: Extract<MessageContentPart, { type: 'file' }>,
): RuntimeAgentMessagePart {
  return {
    type: 'file',
    ...(part.file_id === undefined ? {} : { file_id: part.file_id }),
    ...(part.path === undefined ? {} : { path: part.path }),
    ...(part.url === undefined ? {} : { url: part.url }),
    ...(part.name === undefined ? {} : { name: part.name }),
    ...(part.mime_type === undefined ? {} : { mime_type: part.mime_type }),
    ...(part.text === undefined ? {} : { text: part.text }),
  };
}

function shared_thinking_part_to_runtime_part(
  part: Extract<MessageContentPart, { type: 'thinking' }>,
): RuntimeAgentMessagePart {
  return {
    type: 'thinking',
    thinking: part.thinking,
    ...(part.signature === undefined ? {} : { signature: part.signature }),
    ...(part.redacted === undefined ? {} : { redacted: part.redacted }),
  };
}

function shared_tool_call_part_to_runtime_part(
  part: Extract<MessageContentPart, { type: 'tool_call' }>,
): RuntimeAgentMessagePart {
  return {
    type: 'tool_call',
    id: part.id,
    name: part.name,
    arguments: part.arguments,
    ...(part.thought_signature === undefined ? {} : { thought_signature: part.thought_signature }),
  };
}

function shared_tool_result_part_to_runtime_part(
  part: Extract<MessageContentPart, { type: 'tool_result' }>,
): RuntimeAgentMessagePart {
  return {
    type: 'tool_result',
    ...(part.tool_call_id === undefined ? {} : { tool_call_id: part.tool_call_id }),
    ...(part.tool_name === undefined ? {} : { tool_name: part.tool_name }),
    result: part.result as RuntimeToolResult,
  };
}

function unknown_to_runtime_part(value: unknown): RuntimeAgentMessagePart[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  const record = value as Record<string, unknown>;
  if (record.type === 'text') return unknown_text_part(record);
  if (record.type === 'json') return [{ type: 'json', json: record.json }];
  if (record.type === 'image') return unknown_image_part(record);
  if (record.type === 'thinking') return unknown_thinking_part(record);
  if (record.type === 'tool_call') return unknown_tool_call_part(record);
  if (record.type === 'file') return unknown_file_part(record);
  if (record.type === 'tool_result') return unknown_tool_result_part(record);
  return [];
}

function data_content_to_runtime_parts(content: MessageContent) {
  const data_content = content.data?.content;
  if (!Array.isArray(data_content)) return [];
  return data_content.flatMap(unknown_to_runtime_part);
}

function unknown_text_part(record: Record<string, unknown>): RuntimeAgentMessagePart[] {
  if (typeof record.text !== 'string') return [];
  return [
    {
      type: 'text',
      text: record.text,
      ...(typeof record.text_signature === 'string'
        ? { text_signature: record.text_signature }
        : {}),
    },
  ];
}

function unknown_image_part(record: Record<string, unknown>): RuntimeAgentMessagePart[] {
  if (typeof record.data !== 'string' || typeof record.mime_type !== 'string') return [];
  return [
    {
      type: 'image',
      data: record.data,
      mime_type: record.mime_type,
      ...(record.detail === 'auto' || record.detail === 'low' || record.detail === 'high'
        ? { detail: record.detail }
        : {}),
      ...(typeof record.source === 'string' ? { source: record.source } : {}),
    },
  ];
}

function unknown_thinking_part(record: Record<string, unknown>): RuntimeAgentMessagePart[] {
  if (typeof record.thinking !== 'string') return [];
  return [
    {
      type: 'thinking',
      thinking: record.thinking,
      ...(typeof record.signature === 'string' ? { signature: record.signature } : {}),
      ...(typeof record.redacted === 'boolean' ? { redacted: record.redacted } : {}),
    },
  ];
}

function unknown_tool_call_part(record: Record<string, unknown>): RuntimeAgentMessagePart[] {
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    !record.arguments ||
    typeof record.arguments !== 'object' ||
    Array.isArray(record.arguments)
  ) {
    return [];
  }

  return [
    {
      type: 'tool_call',
      id: record.id,
      name: record.name,
      arguments: record.arguments as Record<string, unknown>,
      ...(typeof record.thought_signature === 'string'
        ? { thought_signature: record.thought_signature }
        : {}),
    },
  ];
}

function unknown_file_part(record: Record<string, unknown>): RuntimeAgentMessagePart[] {
  return [
    {
      type: 'file',
      ...(typeof record.file_id === 'string' ? { file_id: record.file_id } : {}),
      ...(typeof record.path === 'string' ? { path: record.path } : {}),
      ...(typeof record.url === 'string' ? { url: record.url } : {}),
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.mime_type === 'string' ? { mime_type: record.mime_type } : {}),
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
    },
  ];
}

function unknown_tool_result_part(record: Record<string, unknown>): RuntimeAgentMessagePart[] {
  if (!record.result || typeof record.result !== 'object' || Array.isArray(record.result)) {
    return [];
  }

  return [
    {
      type: 'tool_result',
      ...(typeof record.tool_call_id === 'string' ? { tool_call_id: record.tool_call_id } : {}),
      ...(typeof record.tool_name === 'string' ? { tool_name: record.tool_name } : {}),
      result: record.result as RuntimeToolResult,
    },
  ];
}

function parsed_signature_field(field_name: string, signature: string | undefined) {
  if (signature === undefined) return {};

  try {
    return { [field_name]: JSON.parse(signature) };
  } catch {
    return {};
  }
}

function runtime_tool_result_text(result: RuntimeToolResult) {
  if (!result.ok) return result.error_message;
  if (result.content_text) return result.content_text;
  return JSON.stringify(result.content_json ?? result.metadata ?? {});
}
