export function ok<T>(data: T) {
  return { data };
}

export function error_body(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}
