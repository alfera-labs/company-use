const abort_error_names = new Set(['AbortError', 'APIUserAbortError']);
const request_abort_message_pattern =
  /\b(request|operation|stream|fetch)\b.{0,48}\baborted\b|\baborted\b.{0,48}\b(request|operation|stream|fetch)\b/i;

export function is_abort_error(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };

  if (typeof name === 'string' && abort_error_names.has(name)) return true;
  if (code === 'ABORT_ERR') return true;
  return typeof message === 'string' && request_abort_message_pattern.test(message);
}
