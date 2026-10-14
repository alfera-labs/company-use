import { to_time_ms } from '@connectors/sync/sync_markers';
import type { ConnectorSyncCursor, ConnectorSyncPage } from '@connectors/sync_types';

type CountedCursorKind = 'page_number' | 'offset';

const default_first_cursor: Readonly<Record<CountedCursorKind, number>> = {
  page_number: 1,
  offset: 0,
};

function read_counted_kind(page: ConnectorSyncPage): CountedCursorKind | null {
  if (page.cursor_kind === 'page_number' || page.cursor_kind === 'offset') return page.cursor_kind;
  return null;
}

function read_counted_position(
  page: ConnectorSyncPage,
  kind: CountedCursorKind,
  page_cursor: string | null | undefined,
) {
  const stored =
    page_cursor === null || page_cursor === undefined ? Number.NaN : Number(page_cursor);
  if (Number.isInteger(stored)) return stored;
  return page.first_cursor ?? default_first_cursor[kind];
}

export function page_cursor_to_send(
  page: ConnectorSyncPage,
  page_cursor: string | null | undefined,
): string | number | undefined {
  const kind = read_counted_kind(page);
  if (!kind) return page_cursor ?? undefined;
  return read_counted_position(page, kind, page_cursor);
}

export type CountedPageOutcome = {
  page_cursor: string | null;
  item_count: number;
  has_more: unknown;
};

export function next_counted_cursor(
  page: ConnectorSyncPage,
  outcome: CountedPageOutcome,
): string | null {
  const kind = read_counted_kind(page);
  if (!kind || outcome.item_count === 0) return null;
  if (page.page_size !== undefined && outcome.item_count < page.page_size) return null;
  if (page.has_more !== undefined && !outcome.has_more) return null;
  const step = kind === 'offset' ? (page.page_size ?? outcome.item_count) : 1;
  return String(read_counted_position(page, kind, outcome.page_cursor) + step);
}

export function is_counted_cursor(page: ConnectorSyncPage): boolean {
  return read_counted_kind(page) !== null;
}

function to_iso_date(cursor: ConnectorSyncCursor, watermark: string): string {
  const time_ms = to_time_ms(watermark);
  if (time_ms === null) {
    throw new Error(`The watermark ${cursor.param} must be a time to send it as a date.`);
  }
  return new Date(time_ms).toISOString().slice(0, 10);
}

export function watermark_value_to_send(
  cursor: ConnectorSyncCursor,
  watermark: string | undefined,
): string | number | undefined {
  if (watermark === undefined) return watermark;
  if (cursor.marker_format === 'iso_date') return to_iso_date(cursor, watermark);
  if (cursor.param_type !== 'integer') return watermark;
  const seconds = Number(watermark);
  if (!Number.isFinite(seconds)) {
    throw new Error(
      `The watermark ${cursor.param} must be epoch seconds to send it as an integer.`,
    );
  }
  return Math.floor(seconds);
}
