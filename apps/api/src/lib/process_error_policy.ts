export type ProcessErrorHandlers = {
  is_abort_error: (error: unknown) => boolean;
  report: (error: unknown) => void;
  log_warn: (message: string, error: unknown) => void;
  log_error: (error: unknown) => void;
};

export type ProcessErrorSource = 'unhandled_rejection' | 'uncaught_exception';

export type ProcessErrorDecision = 'ignored_abort' | 'reported_continue' | 'reported_exit';

export function report_unhandled_process_error(
  error: unknown,
  source: ProcessErrorSource,
  handlers: ProcessErrorHandlers,
): ProcessErrorDecision {
  if (handlers.is_abort_error(error)) {
    handlers.log_warn('Ignoring expected abort from a cancelled run', error);
    return 'ignored_abort';
  }

  handlers.log_error(error);
  handlers.report(error);
  return source === 'unhandled_rejection' ? 'reported_continue' : 'reported_exit';
}
