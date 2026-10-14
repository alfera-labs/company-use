function sort_json_keys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_json_keys);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sort_json_keys(record[key])]),
  );
}

export function to_content_text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value.join('\n');
  }
  if (typeof value === 'object') return JSON.stringify(sort_json_keys(value), null, 2);
  return String(value);
}

export function expression_text(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}
