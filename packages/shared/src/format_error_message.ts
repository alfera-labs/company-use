/**
 * An AggregateError's own message is only a summary ("E2B file mutation failed."), so the
 * causes it carries are appended; without them a failed write reaches the agent with no reason.
 */
export function format_error_message(error: unknown, fallback?: string): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    const causes = error.errors.map((cause) => format_error_message(cause)).join(' | ');
    return error.message ? `${error.message} ${causes}` : causes;
  }
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}
