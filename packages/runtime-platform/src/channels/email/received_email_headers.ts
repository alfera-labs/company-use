export function normalize_email_headers(
  headers: Record<string, unknown> | Array<{ name: string; value: unknown }> | null | undefined,
): Record<string, unknown> | null {
  if (!headers) return null;
  const entries = Array.isArray(headers)
    ? headers.map((header) => [header.name, header.value] as const)
    : Object.entries(headers);
  return Object.fromEntries(first_value_of_each_header(entries));
}

function first_value_of_each_header(entries: ReadonlyArray<readonly [string, unknown]>) {
  const first_values = new Map<string, unknown>();
  for (const [name, value] of entries) {
    if (!first_values.has(name.toLowerCase())) first_values.set(name.toLowerCase(), value);
  }
  return first_values;
}
