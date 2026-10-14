import { command_exit_code_state, is_stopped_tool_call } from '@/components/app/tool_call_outcome';

export type ToolRowStatus =
  | 'attempted'
  | 'awaiting_approval'
  | 'denied'
  | 'done'
  | 'exit_code'
  | 'failed'
  | 'running'
  | 'stopped';

/** What a tool row shows for the state of its call. A stopped call is not a failed one. */
export function tool_row_status(
  state: string,
  errorText: string | null | undefined,
): ToolRowStatus {
  if (state === 'awaiting_approval') return 'awaiting_approval';
  if (state === 'denied') return 'denied';
  if (is_stopped_tool_call({ state })) return 'stopped';
  if (state === command_exit_code_state) return 'exit_code';
  if (errorText || state === 'failed' || state === 'error') return 'failed';
  if (['complete', 'completed', 'done', 'success', 'succeeded'].includes(state)) return 'done';
  if (state === 'attempted') return 'attempted';
  return 'running';
}

/** The quiet words after the title of a row whose call waits, was refused, stopped or exited. */
export const tool_row_status_words: Partial<Record<ToolRowStatus, string>> = {
  awaiting_approval: 'waiting for your approval',
  denied: 'you refused this',
  exit_code: 'exit code not 0',
  stopped: 'stopped',
};
