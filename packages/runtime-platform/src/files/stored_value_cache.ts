export const stored_value_cache_cap_bytes = 64 * 1024 * 1024;

type CachedText = { text: string; byte_size: number };

const cached_by_object_key = new Map<string, CachedText>();
let cached_bytes = 0;

export function read_cached_stored_text(object_key: string) {
  const cached = cached_by_object_key.get(object_key);
  if (!cached) return undefined;
  cached_by_object_key.delete(object_key);
  cached_by_object_key.set(object_key, cached);
  return cached.text;
}

export function cache_stored_text(object_key: string, text: string, byte_size: number) {
  if (byte_size > stored_value_cache_cap_bytes || cached_by_object_key.has(object_key)) return;
  cached_by_object_key.set(object_key, { text, byte_size });
  cached_bytes += byte_size;
  for (const [oldest_key, oldest] of cached_by_object_key) {
    if (cached_bytes <= stored_value_cache_cap_bytes) break;
    cached_by_object_key.delete(oldest_key);
    cached_bytes -= oldest.byte_size;
  }
}
