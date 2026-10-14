import type { MappedSyncRecord } from '@connectors/sync/map_sync_record';
import { to_time_ms } from '@connectors/sync/sync_markers';

function by_marker_then_identity(left: MappedSyncRecord, right: MappedSyncRecord) {
  const left_ms = to_time_ms(left.cursor_value);
  const right_ms = to_time_ms(right.cursor_value);
  if (left_ms !== null && right_ms !== null && left_ms !== right_ms) return left_ms - right_ms;
  return left.external_item_id.localeCompare(right.external_item_id);
}

export function group_records_by_bucket(
  records: readonly MappedSyncRecord[],
): Map<string, MappedSyncRecord[]> {
  const buckets = new Map<string, MappedSyncRecord[]>();
  for (const record of records) {
    const key = record.bucket_key;
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort(by_marker_then_identity);
  }
  return buckets;
}

function read_bucket_participants(records: readonly MappedSyncRecord[]): string[] {
  const names = new Set<string>();
  for (const record of records) {
    const author = record.metadata.author;
    if (typeof author === 'string' && author.length > 0) names.add(author);
    const reply_authors = record.metadata.reply_authors;
    if (!Array.isArray(reply_authors)) continue;
    for (const name of reply_authors) {
      if (typeof name === 'string' && name.length > 0) names.add(name);
    }
  }
  return [...names];
}

export function merge_bucket_metadata(
  records: readonly MappedSyncRecord[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record.metadata)) {
      const existing = merged[key];
      merged[key] =
        Array.isArray(existing) && Array.isArray(value)
          ? [...new Set([...existing, ...value])]
          : value;
    }
  }
  merged.record_count = records.length;
  const participants = read_bucket_participants(records);
  if (participants.length > 0) merged.participants = participants;
  return merged;
}
