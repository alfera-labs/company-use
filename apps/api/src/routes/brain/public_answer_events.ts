import { public_run_failure_message } from '@runtime-platform/chat_stream/public_run_output';
import type { AgentRunStreamEvent } from '@runtime-platform/orchestrator/runtime_orchestrator';

export type PublicAnswerStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

export type PublicAnswerSource = {
  brain_item_id: string;
  title: string;
  app_key: string;
  location: string;
  source_url: string | null;
  synced_at: string | null;
};

export type PublicAnswer = {
  answer_id: string;
  status: PublicAnswerStatus;
  output_text: string;
  conversation_id: string | null;
  usage: { input_tokens: number; output_tokens: number };
  sources?: PublicAnswerSource[];
  error?: PublicAnswerError;
};

export type PublicAnswerError = { code: string; message: string };

export type PublicAnswerEvent =
  | { event: 'answer.created'; data: { answer_id: string; conversation_id: string | null } }
  | { event: 'answer.delta'; data: { text: string } }
  | { event: 'answer.completed'; data: PublicAnswer }
  | { event: 'answer.failed'; data: { error: PublicAnswerError } }
  | { event: 'done'; data: { ok: true } };

export const public_answer_event_names = [
  'answer.created',
  'answer.delta',
  'answer.completed',
  'answer.failed',
  'done',
] as const;

export function project_public_answer_events(
  event: AgentRunStreamEvent,
  conversation_id: string | null,
): PublicAnswerEvent[] {
  if (event.type === 'run_created') {
    return [{ event: 'answer.created', data: { answer_id: event.run.run_id, conversation_id } }];
  }
  const text = read_assistant_text_delta(event);
  return text ? [{ event: 'answer.delta', data: { text } }] : [];
}

function read_assistant_text_delta(event: AgentRunStreamEvent): string | null {
  if (event.type !== 'chat_event') return null;
  if (event.event.event_type !== 'item_delta') return null;
  if (event.event.delta.delta_type !== 'text_delta') return null;
  return event.event.delta.text || null;
}

const readable_failure_codes = new Set([
  'out_of_credits',
  'card_required',
  'conversation_busy',
  'answer_not_runnable',
]);

export function public_answer_error(
  failure: { code?: string | null; message?: string | null } | null | undefined,
): PublicAnswerError {
  const code = failure?.code ?? '';
  if (!readable_failure_codes.has(code)) {
    return { code: 'run_failed', message: public_run_failure_message };
  }
  return { code, message: failure?.message?.trim() || public_run_failure_message };
}
