import { remove_message_text_file_note } from '@/components/app/message_text_file_note';
import type { Run, RunMessage } from '@/lib/api';

export function find_visible_chat_messages(messages: RunMessage[]) {
  return messages.filter(
    (message) =>
      ['user', 'assistant'].includes(message.message_role) && is_visible_chat_message(message),
  );
}

export function upsert_run(runs: Run[] | undefined, run: Run) {
  const next_runs = runs ? [...runs] : [];
  const existing_index = next_runs.findIndex((item) => item.run_id === run.run_id);

  if (existing_index === -1) next_runs.push(run);
  else next_runs[existing_index] = run;

  return next_runs.sort(
    (left, right) => new Date(right.created_time).getTime() - new Date(left.created_time).getTime(),
  );
}

export function merge_message_pages(
  existing: RunMessage[] | undefined,
  fresh: readonly RunMessage[],
) {
  const messages_by_id = new Map(
    (existing ?? []).map((message) => [message.run_message_id, message]),
  );
  for (const message of fresh) messages_by_id.set(message.run_message_id, message);
  return [...messages_by_id.values()].sort(
    (left, right) => left.message_sequence - right.message_sequence,
  );
}

export function upsert_message(messages: RunMessage[] | undefined, message: RunMessage) {
  const next_messages = messages ? [...messages] : [];
  const existing_index = next_messages.findIndex(
    (item) => item.run_message_id === message.run_message_id,
  );

  if (existing_index === -1) next_messages.push(message);
  else next_messages[existing_index] = message;

  return next_messages.sort((left, right) => left.message_sequence - right.message_sequence);
}

export function read_chat_message_text(content: RunMessage['message_content']) {
  if (content.text) return remove_message_text_file_note(content.text);
  const parts = content.parts ?? [];
  return remove_message_text_file_note(
    parts.map(read_message_part_text).filter(Boolean).join('\n'),
  );
}

export function format_chat_text(text: string) {
  return text.replace(/\s+Tools:\s*none\.$/u, '.');
}

function is_visible_chat_message(message: RunMessage) {
  if (message.is_user_visible === false) return false;
  if (message.message_role !== 'assistant') return true;

  if (message.message_content.data?.has_visible_text === false) return false;
  if (message.source_metadata.has_visible_text === false) return false;

  return read_chat_message_text(message.message_content).trim().length > 0;
}

export function read_chat_message_files(content: RunMessage['message_content']) {
  return (content.parts ?? []).flatMap((part, part_index) =>
    part.type === 'file' && !is_sandbox_plumbing_part(part)
      ? [
          {
            key: part.file_id ?? `${part_index}:${part.name ?? 'file'}`,
            ...(part.file_id ? { file_id: part.file_id } : {}),
            ...(part.name ? { name: part.name } : {}),
            ...(part.mime_type ? { mime_type: part.mime_type } : {}),
            is_inline_text: Boolean(part.text) && !part.file_id,
          },
        ]
      : [],
  );
}

function is_sandbox_plumbing_part(
  part: Extract<NonNullable<RunMessage['message_content']['parts']>[number], { type: 'file' }>,
) {
  return Boolean(part.path) && !part.file_id && !part.text;
}

export function read_chat_message_images(content: RunMessage['message_content']) {
  return (content.parts ?? []).flatMap((part, part_index) =>
    part.type === 'image' && part.data
      ? [
          {
            key: `${part_index}:${part.source ?? 'image'}`,
            data_url: `data:${part.mime_type};base64,${part.data}`,
            ...(part.source ? { name: part.source } : {}),
          },
        ]
      : [],
  );
}

function read_message_part_text(part: NonNullable<RunMessage['message_content']['parts']>[number]) {
  if (part.type === 'text') return part.text;
  if (part.type === 'image') {
    return `[image${part.source ? `: ${part.source}` : ''}]`;
  }
  if (part.type === 'file') return '';
  if (part.type === 'tool_result') return tool_result_part_text(part);
  return '';
}

/** The words of a tool result, led by the name of its tool. */
export function tool_result_part_text(
  part: Extract<
    NonNullable<RunMessage['message_content']['parts']>[number],
    { type: 'tool_result' }
  >,
) {
  const tool_name = part.tool_name ?? 'tool';
  const result = part.result as {
    content_text?: string;
    error_message?: string;
    content_json?: unknown;
  };
  if (result.content_text?.trim()) {
    return `[${tool_name}] ${result.content_text}`;
  }
  if (result.error_message?.trim()) {
    return `[${tool_name}] ${result.error_message}`;
  }
  if (result.content_json !== undefined)
    return `[${tool_name}] ${stringify_value(result.content_json)}`;
  return `[${tool_name}] ${stringify_value(part.result)}`;
}

/** A value as text a person can read: a string as it is, anything else as indented JSON. */
export function stringify_value(value: unknown) {
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
