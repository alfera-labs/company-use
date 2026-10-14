export function order_keys_like_jsonb<T>(value: T): T {
  if (Array.isArray(value)) return value.map(order_keys_like_jsonb) as T;
  if (value === null || typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => compare_jsonb_keys(left, right));
  return Object.fromEntries(
    entries.map(([key, nested]) => [key, order_keys_like_jsonb(nested)]),
  ) as T;
}

const utf8 = new TextEncoder();

function compare_jsonb_keys(left: string, right: string) {
  const left_bytes = utf8.encode(left);
  const right_bytes = utf8.encode(right);
  if (left_bytes.length !== right_bytes.length) return left_bytes.length - right_bytes.length;
  const differing_index = left_bytes.findIndex((byte, index) => byte !== right_bytes[index]);
  if (differing_index === -1) return 0;
  return (left_bytes[differing_index] ?? 0) - (right_bytes[differing_index] ?? 0);
}
