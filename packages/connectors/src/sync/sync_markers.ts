import type { ConnectorSyncObject } from '@connectors/sync_types';

function read_marker_text(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

const json_date_marker = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/u;

export function to_time_ms(marker: string | null | undefined): number | null {
  if (!marker) return null;
  if (/^\d+(\.\d+)?$/.test(marker)) return Number(marker) * 1000;
  const json_date = json_date_marker.exec(marker);
  if (json_date) return Number(json_date[1]);
  const parsed = Date.parse(marker);
  return Number.isNaN(parsed) ? null : parsed;
}

export function move_marker_back(marker: string, milliseconds: number): string {
  const time_ms = to_time_ms(marker);
  if (time_ms === null) return marker;
  const moved_ms = Math.max(0, time_ms - milliseconds);
  if (/^\d+(\.\d+)?$/.test(marker)) return (moved_ms / 1000).toFixed(6);
  return new Date(moved_ms).toISOString();
}

export function is_newer_marker(candidate: string, current: string | null | undefined): boolean {
  if (!current) return true;
  const candidate_ms = to_time_ms(candidate);
  const current_ms = to_time_ms(current);
  if (candidate_ms !== null && current_ms !== null) return candidate_ms > current_ms;
  return candidate > current;
}

export function to_bucket_day(value: unknown): string | null {
  const time_ms = to_time_ms(read_marker_text(value));
  if (time_ms === null) return null;
  return new Date(time_ms).toISOString().slice(0, 10);
}

function format_marker(
  time_ms: number,
  marker_format: 'epoch_seconds' | 'iso_time' | 'iso_date' | undefined,
) {
  if (marker_format === 'epoch_seconds') return (time_ms / 1000).toFixed(6);
  if (marker_format === 'iso_date') return new Date(time_ms).toISOString().slice(0, 10);
  return new Date(time_ms).toISOString();
}

export function marker_at_time(recipe: ConnectorSyncObject, time: Date): string {
  return format_marker(time.getTime(), recipe.cursor?.marker_format);
}

function initial_watermark(recipe: ConnectorSyncObject, now: Date): string | undefined {
  const lookback_days = recipe.cursor?.initial_lookback_days;
  if (lookback_days === undefined) return undefined;
  const marker_ms = now.getTime() - lookback_days * 24 * 60 * 60 * 1000;
  return floor_bucket_marker(recipe, format_marker(marker_ms, recipe.cursor?.marker_format));
}

export function watermark_to_send(
  recipe: ConnectorSyncObject,
  watermark: string | null | undefined,
  now: Date,
): string | undefined {
  if (!recipe.cursor) return undefined;
  if (!watermark) return initial_watermark(recipe, now);
  const overlapped = recipe.cursor.overlap_minutes
    ? move_marker_back(watermark, recipe.cursor.overlap_minutes * 60 * 1000)
    : watermark;
  if (recipe.edit_window_days === undefined) return floor_bucket_marker(recipe, overlapped);

  const window_ms = now.getTime() - recipe.edit_window_days * 24 * 60 * 60 * 1000;
  const overlapped_ms = to_time_ms(overlapped);
  if (overlapped_ms === null || overlapped_ms <= window_ms) {
    return floor_bucket_marker(recipe, overlapped);
  }
  return floor_bucket_marker(recipe, move_marker_back(overlapped, overlapped_ms - window_ms));
}

function floor_bucket_marker(
  recipe: ConnectorSyncObject,
  marker: string | undefined,
): string | undefined {
  if (!recipe.bucket || !marker) return marker;
  const time_ms = to_time_ms(marker);
  if (time_ms === null) return marker;
  const moment = new Date(time_ms);
  const day_start_ms = Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate());
  return move_marker_back(marker, time_ms - day_start_ms);
}
