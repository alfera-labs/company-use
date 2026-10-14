import type { SessionMessageMatchRow } from '@coworker/core/db/queries/session_message_search';
import type {
  VisibleActiveRunRow,
  VisibleSessionRow,
} from '@coworker/core/db/queries/visible_sessions';
import type { run_messages } from '@coworker/core/db/schema';
import type { MessageContent } from '@coworker/shared';

const message_text_char_cap = 2_000;
const tool_payload_preview_char_cap = 200;

export function summarize_visible_session(session: VisibleSessionRow) {
  return {
    session_id: session.session_id,
    title: session.session_title,
    source: session.session_source,
    project_id: session.project_id,
    last_message_time: iso_time(session.last_message_time ?? session.last_updated_time),
    status: session.active_run_id ? ('running' as const) : ('idle' as const),
  };
}

export function summarize_active_run(run: VisibleActiveRunRow) {
  return {
    run_id: run.run_id,
    session_id: run.session_id,
    session_title: run.session_title,
    session_source: run.session_source,
    run_status: run.run_status,
    run_reason: run.run_reason,
    automation_id: run.automation_id,
    automation_name: run.automation_name,
    started_time: iso_time(run.started_time),
    created_time: iso_time(run.created_time) ?? '',
  };
}

export function summarize_message_match(match: SessionMessageMatchRow) {
  return {
    session_id: match.session_id,
    session_title: match.session_title,
    session_source: match.session_source,
    message_sequence: match.matched_message_sequence,
    last_message_time: iso_time(match.last_message_time),
    snippet: match.snippet,
  };
}

type StoredMessageRow = Pick<
  typeof run_messages.$inferSelect,
  'message_role' | 'message_content' | 'message_sequence' | 'created_time'
>;

export function summarize_session_message(message: StoredMessageRow) {
  const parts = message.message_content.parts ?? [];
  return {
    message_sequence: message.message_sequence,
    role: message.message_role,
    created_time: iso_time(message.created_time) ?? '',
    text: message_text(message.message_content, parts),
    tool_calls: parts.flatMap(summarized_tool_call),
    tool_results: parts.flatMap(summarized_tool_result),
    files: parts.flatMap(file_reference),
    image_count: parts.filter((part) => part.type === 'image').length,
  };
}

type MessagePart = NonNullable<MessageContent['parts']>[number];

function message_text(content: { text?: string | undefined }, parts: MessagePart[]) {
  const spoken = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
  const text = spoken || content.text || '';
  return text ? capped(text, message_text_char_cap) : null;
}

function summarized_tool_call(part: MessagePart) {
  if (part.type !== 'tool_call') return [];
  return [
    {
      tool_call_id: part.id || null,
      name: part.name,
      input_preview: short_json(part.arguments),
    },
  ];
}

function summarized_tool_result(part: MessagePart) {
  if (part.type !== 'tool_result') return [];
  return [
    {
      tool_call_id: part.tool_call_id ?? null,
      name: part.tool_name ?? null,
      result_preview: short_json(part.result),
    },
  ];
}

function file_reference(part: MessagePart) {
  if (part.type !== 'file') return [];
  return [
    {
      file_id: part.file_id ?? null,
      name: part.name ?? null,
      path: part.path ?? null,
      mime_type: part.mime_type ?? null,
    },
  ];
}

function short_json(value: unknown) {
  const serialized = safe_json(value);
  return capped(serialized, tool_payload_preview_char_cap);
}

function safe_json(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function capped(text: string, cap: number) {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}… [${text.length - cap} more characters]`;
}

function iso_time(time: Date | string | null | undefined) {
  if (!time) return null;
  return time instanceof Date ? time.toISOString() : new Date(time).toISOString();
}
