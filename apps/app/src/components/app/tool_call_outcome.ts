type ToolCallOutcomeFields = {
  state: string;
  errorCode?: string | null | undefined;
  errorText?: string | null | undefined;
};

/** The code the API gives a command that ran to its end with an exit code other than 0. */
export const command_exit_code_error = 'command_failed';

/** The state a tool row shows for such a command. */
export const command_exit_code_state = 'exited_with_code';

const completed_states = new Set(['complete', 'completed', 'done', 'success', 'succeeded']);
const failed_states = new Set(['blocked', 'error', 'failed', 'timed_out']);

/** A tool call that a stop of the run ended. Its error text only says that it was stopped. */
export function is_stopped_tool_call(call: Pick<ToolCallOutcomeFields, 'state'>) {
  return call.state === 'cancelled';
}

/**
 * A command that ran to its end with an exit code other than 0. That is not always a failure:
 * `grep -c` ends with 1 when it counts nothing. Nothing here can tell the two apart, so the chat
 * names the exit code in plain colour and does not call the step failed.
 */
export function has_command_ended_with_exit_code(call: Pick<ToolCallOutcomeFields, 'errorCode'>) {
  return call.errorCode === command_exit_code_error;
}

/** A tool call that ended in an error, a block or a timeout. A stopped call is not a failure. */
export function is_failed_tool_call(call: ToolCallOutcomeFields) {
  if (is_stopped_tool_call(call) || has_command_ended_with_exit_code(call)) return false;
  return Boolean(call.errorText) || failed_states.has(call.state);
}

/** A tool call that will not change any more: it completed, failed or was stopped. */
export function has_tool_call_ended(call: ToolCallOutcomeFields) {
  return (
    is_failed_tool_call(call) ||
    is_stopped_tool_call(call) ||
    has_command_ended_with_exit_code(call) ||
    completed_states.has(call.state)
  );
}

/**
 * What a tool row shows for the end of its call. A command that ended with an exit code is
 * drawn as a command that ran: its text is its output, in plain colour.
 */
export function tool_row_outcome(
  call: ToolCallOutcomeFields & { output?: unknown },
  row_state: string,
) {
  if (has_command_ended_with_exit_code(call)) {
    return { state: command_exit_code_state, output: call.errorText ?? call.output };
  }
  return {
    state: row_state,
    ...(call.errorText ? { errorText: call.errorText } : {}),
    ...(call.output === undefined ? {} : { output: call.output }),
  };
}
