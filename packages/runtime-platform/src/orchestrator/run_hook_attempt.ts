import { create_logger, format_error_message } from '@coworker/shared';
import { PolicyTimeoutError, run_with_timeout } from '@runtime-platform/tools/run_with_timeout';

const log = create_logger('run_hooks');

/** The four moments of a run where hooks plug in. */
export type RunHookPhase = 'prepare' | 'after_workspace_write' | 'before_turn' | 'settle';

/** What every hook record declares: a plain name for logs and a deadline in milliseconds. */
export type RunHookRecord = { hook_name: string; timeout_ms: number };

/** Why one hook did not finish its job. A hook may also report a failure as its own result. */
export type RunHookFailure =
  | { failure: 'threw'; error_message: string }
  | { failure: 'timed_out'; timeout_ms: number }
  | { failure: 'reported'; reason: string };

/** The result of one hook attempt: the hook's own value, or the failure the runner caught. */
export type RunHookAttempt<T> =
  | { outcome: 'ran'; value: T }
  | { outcome: 'failed'; failure: RunHookFailure };

/** Who the hook ran for. Every failure log line carries it. */
export type RunHookLogContext = { run_id: string; workspace_id: string } & Record<string, unknown>;

/**
 * Runs one hook under its deadline and turns a throw or a timeout into a tagged failure. This is
 * the one edge where a hook's exception is caught. Every failure is logged with the phase, the
 * hook name and the run, so no hook fails without a trace.
 */
export async function attempt_run_hook<T>(input: {
  hook: RunHookRecord;
  phase: RunHookPhase;
  log_context: RunHookLogContext;
  signal: AbortSignal | undefined;
  run: (signal: AbortSignal) => Promise<T>;
}): Promise<RunHookAttempt<T>> {
  try {
    const value = await run_with_timeout(input.hook.timeout_ms, input.signal, input.run);
    return { outcome: 'ran', value };
  } catch (error) {
    const failure = failure_from_error(error);
    log_run_hook_failure(input, failure);
    return { outcome: 'failed', failure };
  }
}

/** Logs a failure that a hook reported in its own result. */
export function log_run_hook_failure(
  input: { hook: RunHookRecord; phase: RunHookPhase; log_context: RunHookLogContext },
  failure: RunHookFailure,
) {
  log.error('A run hook failed.', {
    ...input.log_context,
    phase: input.phase,
    hook_name: input.hook.hook_name,
    ...failure,
  });
}

/** Names a hook failure in one line for a tool result or an error message. */
export function describe_run_hook_failure(failure: RunHookFailure) {
  switch (failure.failure) {
    case 'timed_out':
      return `timed out after ${failure.timeout_ms}ms`;
    case 'threw':
      return failure.error_message;
    case 'reported':
      return failure.reason;
  }
}

/** Turns a reason a hook reported into a tagged failure, and logs it the same way every hook does. */
export function reported_run_hook_failure(
  step: { hook: RunHookRecord; phase: RunHookPhase; log_context: RunHookLogContext },
  reason: string,
): RunHookFailure {
  const failure: RunHookFailure = { failure: 'reported', reason };
  log_run_hook_failure(step, failure);
  return failure;
}

function failure_from_error(error: unknown): RunHookFailure {
  if (error instanceof PolicyTimeoutError) {
    return { failure: 'timed_out', timeout_ms: error.timeout_ms };
  }
  return { failure: 'threw', error_message: format_error_message(error) };
}
