import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { err } from '@runtime-platform/tools/workspace_tool_results';

export const stopped_tool_error_code = 'cancelled';

/**
 * A tool call that did not succeed and whose run was stopped ends as stopped, not as failed:
 * the stop ended it, so its exit code or its error says nothing about the work. A call that
 * finished its work before the stop keeps its result.
 */
export function stopped_result_when_run_was_stopped(
  result: RuntimeToolResult,
  run_signal: AbortSignal | undefined,
): RuntimeToolResult {
  if (result.ok || !run_signal?.aborted) return result;
  return err(stopped_tool_error_code, 'Stopped before it finished.', result.metadata);
}
