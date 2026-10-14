import { to_time_ms } from '@connectors/sync/sync_markers';
import type { ConnectorSyncObject } from '@connectors/sync_types';
import type { ConnectorError } from '@connectors/types';

const day_ms = 24 * 60 * 60 * 1000;

export function watermark_is_too_old(
  recipe: ConnectorSyncObject,
  watermark: string | null,
  now: Date,
): boolean {
  const max_age_days = recipe.cursor?.max_age_days;
  if (max_age_days === undefined || !watermark) return false;
  const watermark_ms = to_time_ms(watermark);
  if (watermark_ms === null) return false;
  return watermark_ms < now.getTime() - max_age_days * day_ms;
}

export function is_expired_watermark_error(
  recipe: ConnectorSyncObject,
  error: ConnectorError,
): boolean {
  const markers = recipe.cursor?.expired_error_contains ?? [];
  return markers.some((marker) => error.message.includes(marker));
}
