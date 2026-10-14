import { public_answer_error } from '@api/routes/brain/public_answer_events';
import type { PublicSessionUsage } from '@api/services/sessions_api/public_session';
import type { PublicTextBlock } from '@api/services/sessions_api/session_service';
import { tool_policy_awaiting_approval_event_label } from '@coworker/core/access/tool_policy_approval_schema';
import type {
  ChatContentPart,
  ChatStreamEventDraft,
  ChatThreadItem,
  ToolCallItem,
} from '@coworker/shared';
import { ValidationError } from '@coworker/shared';

type PublicStopReason = 'end_turn' | 'requires_action' | 'out_of_credits';

export type PublicSessionEvent = { id: string; created_time: Date } & (
  | { type: 'user.message'; content: PublicTextBlock[] }
  | { type: 'user.tool_confirmation'; tool_use_id: string; result: 'allow' | 'deny' }
  | { type: 'agent.message'; content: PublicTextBlock[] }
  | { type: 'agent.thinking' }
  | {
      type: 'agent.tool_use';
      tool_use_id: string;
      tool_name: string;
      input: unknown;
      input_truncated?: true;
    }
  | {
      type: 'agent.tool_result';
      tool_use_id: string;
      is_error: boolean;
      content: string;
      truncated?: true;
    }
  | { type: 'session.status_running' }
  | { type: 'session.status_idle'; stop_reason: PublicStopReason; tool_use_ids?: string[] }
  | { type: 'session.status_terminated' }
  | { type: 'session.error'; error: { code: string; message: string } }
  | { type: 'session.usage'; usage: PublicSessionUsage }
);

export type PublicSessionEventType = PublicSessionEvent['type'];

export const public_session_event_types = [
  'user.message',
  'user.tool_confirmation',
  'agent.message',
  'agent.thinking',
  'agent.tool_use',
  'agent.tool_result',
  'session.status_running',
  'session.status_idle',
  'session.status_terminated',
  'session.error',
  'session.usage',
] as const satisfies readonly PublicSessionEventType[];

export const api_tool_confirmation_event_label = 'sessions_api.tool_confirmation';

export type SessionEventPosition = { run_id: string; event_sequence: number; slot: number };

const public_event_id_prefix = 'sevt_';

export const user_message_event_sequence = 0;

const waiting_run_status = 'waiting';

const billing_stop_codes = new Set(['out_of_credits', 'card_required']);

function encode_session_event_id(position: SessionEventPosition): string {
  const locator = `${position.run_id}|${position.event_sequence}|${position.slot}`;
  return public_event_id_prefix + Buffer.from(locator, 'utf8').toString('base64url');
}

export function decode_session_event_id(id: string): SessionEventPosition {
  const [run_id, event_sequence, slot] = Buffer.from(
    id.slice(public_event_id_prefix.length),
    'base64url',
  )
    .toString('utf8')
    .split('|');
  if (!id.startsWith(public_event_id_prefix) || run_id === undefined || !slot) {
    throw new ValidationError('That event id is not one this API issued');
  }
  return {
    run_id,
    event_sequence: Number(event_sequence),
    slot: Number(slot),
  };
}

const public_text_limit_characters = 16 * 1024;

export type SessionEventRun = {
  run_id: string;
  error_code: string | null;
  usage: PublicSessionUsage;
};

export type SessionRunEventRow = {
  run_id: string;
  event_sequence: number;
  event_type: string;
  event_label: string | null;
  event_data: unknown;
  created_time: Date;
};

export function project_session_run_event(
  row: SessionRunEventRow,
  run: SessionEventRun,
): PublicSessionEvent[] {
  if (row.event_type === 'progress' && row.event_label === api_tool_confirmation_event_label) {
    return project_tool_confirmation(row);
  }
  if (
    row.event_type === 'progress' &&
    row.event_label === tool_policy_awaiting_approval_event_label
  ) {
    return project_requires_action(row);
  }
  if (row.event_type !== 'chat_event') return [];

  const draft = row.event_data as ChatStreamEventDraft;
  const at = (slot: number) => event_header(row, slot);
  if (draft.event_type === 'run_started') return [{ ...at(0), type: 'session.status_running' }];
  if (draft.event_type === 'run_completed') {
    return project_run_completed(row, run, draft.run_status);
  }
  if (draft.event_type === 'stream_error') {
    return [{ ...at(0), type: 'session.error', error: public_answer_error(draft.error) }];
  }
  if (draft.event_type === 'item_started' || draft.event_type === 'item_completed') {
    return project_thread_item(row, draft.item, draft.event_type === 'item_completed');
  }
  if (draft.event_type === 'item_updated') return project_thread_item_patch(row, draft.patch);
  return [];
}

function project_thread_item_patch(
  row: SessionRunEventRow,
  patch: Partial<ChatThreadItem>,
): PublicSessionEvent[] {
  if (patch.item_status !== 'complete') return [];
  if (!('parts' in patch) || !Array.isArray(patch.parts)) return [];
  return agent_message_events(event_header(row, 0), patch.parts);
}

function project_run_completed(
  row: SessionRunEventRow,
  run: SessionEventRun,
  stored_run_status: string,
): PublicSessionEvent[] {
  const usage: PublicSessionEvent = {
    ...event_header(row, 0),
    type: 'session.usage',
    usage: run.usage,
  };
  if (stored_run_status === waiting_run_status) return [usage];
  return [
    usage,
    {
      ...event_header(row, 1),
      type: 'session.status_idle',
      stop_reason: billing_stop_codes.has(run.error_code ?? '') ? 'out_of_credits' : 'end_turn',
    },
  ];
}

function project_thread_item(
  row: SessionRunEventRow,
  item: ChatThreadItem,
  is_completed: boolean,
): PublicSessionEvent[] {
  const header = event_header(row, 0);
  if (item.item_type === 'assistant_message') {
    return is_completed ? agent_message_events(header, item.parts) : [];
  }
  if (item.item_type === 'thinking') {
    return is_completed ? [] : [{ ...header, type: 'agent.thinking' }];
  }
  if (item.item_type !== 'tool_call' || !is_the_stored_tool_call(item)) return [];
  return [
    is_completed
      ? {
          ...header,
          type: 'agent.tool_result',
          tool_use_id: item.tool_call_id,
          is_error: item.item_status === 'failed' || Boolean(item.error),
          ...bounded_text(item.output_text ?? ''),
        }
      : {
          ...header,
          type: 'agent.tool_use',
          tool_use_id: item.tool_call_id,
          tool_name: item.tool_name,
          ...bounded_input(item.input_data),
        },
  ];
}

function agent_message_events(
  header: { id: string; created_time: Date },
  parts: readonly ChatContentPart[],
): PublicSessionEvent[] {
  const content = parts.flatMap((part) =>
    part.type === 'text' && part.text ? [{ type: 'text' as const, text: part.text }] : [],
  );
  return content.length === 0 ? [] : [{ ...header, type: 'agent.message', content }];
}

function is_the_stored_tool_call(item: ToolCallItem) {
  return item.tool_call_id !== item.provider_tool_call_id;
}

function project_tool_confirmation(row: SessionRunEventRow): PublicSessionEvent[] {
  const data = row.event_data as { tool_use_id?: unknown; result?: unknown };
  if (typeof data.tool_use_id !== 'string') return [];
  if (data.result !== 'allow' && data.result !== 'deny') return [];
  return [
    {
      ...event_header(row, 0),
      type: 'user.tool_confirmation',
      tool_use_id: data.tool_use_id,
      result: data.result,
    },
  ];
}

export function public_user_message_event(input: {
  run_id: string;
  slot: number;
  created_time: Date;
  content: PublicTextBlock[];
}): PublicSessionEvent {
  return {
    id: encode_session_event_id({
      run_id: input.run_id,
      event_sequence: user_message_event_sequence,
      slot: input.slot,
    }),
    created_time: input.created_time,
    type: 'user.message',
    content: input.content,
  };
}

function project_requires_action(row: SessionRunEventRow): PublicSessionEvent[] {
  const data = row.event_data as { tool_call_ids?: unknown };
  const held = Array.isArray(data.tool_call_ids)
    ? data.tool_call_ids.filter((id): id is string => typeof id === 'string')
    : [];
  if (held.length === 0) return [];
  return [
    {
      ...event_header(row, 0),
      type: 'session.status_idle',
      stop_reason: 'requires_action',
      tool_use_ids: held,
    },
  ];
}

export function session_terminated_event(created_time: Date): PublicSessionEvent {
  return {
    id: encode_session_event_id({ run_id: '', event_sequence: 0, slot: 0 }),
    created_time,
    type: 'session.status_terminated',
  };
}

function event_header(row: SessionRunEventRow, slot: number) {
  return {
    id: encode_session_event_id({
      run_id: row.run_id,
      event_sequence: row.event_sequence,
      slot,
    }),
    created_time: row.created_time,
  };
}

function bounded_text(text: string) {
  if (text.length <= public_text_limit_characters) return { content: text };
  return { content: text.slice(0, public_text_limit_characters), truncated: true as const };
}

// A tool input past the bound is dropped whole rather than trimmed field by field —
// a half-serialized argument object is a lie about what the agent called. Trim per field if
// callers ever need to read the small arguments of a call with one huge one.
function bounded_input(input_data: unknown) {
  const serialized = JSON.stringify(input_data ?? null) ?? 'null';
  if (serialized.length <= public_text_limit_characters) return { input: input_data ?? null };
  return { input: null, input_truncated: true as const };
}
