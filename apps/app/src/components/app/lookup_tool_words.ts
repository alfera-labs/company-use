import { is_failed_tool_call, is_stopped_tool_call } from '@/components/app/tool_call_outcome';

export type LookupToolTense = 'running' | 'done' | 'failed' | 'attempted';

export type LookupToolRowLabel = { lead: string; detail?: string };

const completed_states = new Set(['complete', 'completed', 'done', 'success', 'succeeded']);

export function read_lookup_tool_tense(input: {
  state: string;
  error_text?: string | null | undefined;
  is_run_active: boolean;
}): LookupToolTense {
  if (is_stopped_tool_call(input)) return 'attempted';
  if (is_failed_tool_call({ state: input.state, errorText: input.error_text })) return 'failed';
  if (completed_states.has(input.state)) return 'done';
  return input.is_run_active ? 'running' : 'attempted';
}

const chat_lookback_tool_name_re = /^runtime-search_context-\d+$/;

export function is_chat_lookback_tool_name(tool_name: string) {
  return chat_lookback_tool_name_re.test(tool_name);
}

export const chat_lookback_labels: Record<LookupToolTense, string> = {
  running: 'Looking back through this chat',
  done: 'Looked back through this chat',
  failed: 'Could not look back through this chat',
  attempted: 'Tried to look back through this chat',
};
