import type { Database } from '@coworker/core';
import { stored_run_event_file_purpose } from '@coworker/core/db/queries/files';
import { create_run_event, create_run_events } from '@coworker/core/db/queries/sessions';
import {
  create_logger,
  order_keys_like_jsonb,
  strip_unstorable_characters,
} from '@coworker/shared';
import {
  type ArtifactRef,
  is_large_value,
  load_stored_values,
  store_large_value,
} from '@runtime-platform/files/stored_body';
import { move_fields_in_order } from '@runtime-platform/tools/stored_tool_result_fields';
import {
  list_refs_inside,
  move_large_values_inside,
  put_values_back_inside,
} from '@runtime-platform/tools/stored_tool_result_nested_values';

export const run_event_payload_shape = 'run_event_payload_v2';
const payload_columns = ['event_data', 'event_metadata'] as const;
const log = create_logger('stored_run_event_payloads');

export type RunEventPayloadReading = 'load_full_value' | 'use_preview';

type RunEventPayload = {
  tool_call_id?: string | null | undefined;
  event_data?: unknown;
  event_metadata?: unknown;
  metadata?: unknown;
};
type StoreScope = { workspace_id: string; session_id: string; run_id: string; actor_id: string };

export async function move_large_run_event_fields<T extends RunEventPayload>(
  db: Database,
  scope: StoreScope,
  event: T,
): Promise<T> {
  if (!payload_columns.some((column) => is_large_value(event[column]))) return event;
  let moved_values = 0;
  const pointer_for = async (value: unknown) => {
    if (!is_large_value(value)) return value;
    const artifact_ref = await store_value(db, scope, event.tool_call_id ?? null, value);
    if (!artifact_ref) return value;
    moved_values += 1;
    return { artifact_ref };
  };
  const moved: Record<string, unknown> = { ...event };
  await move_fields_in_order(payload_columns, event, moved, (value) =>
    move_large_values_inside(strip_unstorable_characters(value), pointer_for),
  );
  if (moved_values === 0) return event;
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  return { ...moved, metadata: { ...metadata, payload_shape: run_event_payload_shape } } as T;
}

async function store_value(
  db: Database,
  scope: StoreScope,
  tool_call_id: string | null,
  value: unknown,
): Promise<ArtifactRef | null> {
  try {
    return await store_large_value(db, {
      workspace_id: scope.workspace_id,
      session_id: scope.session_id,
      run_id: scope.run_id,
      actor_id: scope.actor_id,
      source_tool_call_id: tool_call_id,
      file_purpose: stored_run_event_file_purpose,
      value,
    });
  } catch (error) {
    log.error('Storing a run event value failed; it stays inline.', {
      workspace_id: scope.workspace_id,
      run_id: scope.run_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function create_stored_run_event(
  db: Database,
  input: Parameters<typeof create_run_event>[1],
) {
  return create_run_event(db, await move_large_run_event_fields(db, input, input));
}

export async function create_stored_run_events(
  db: Database,
  input: Parameters<typeof create_run_events>[1],
) {
  const events = await Promise.all(
    input.events.map((event) => move_large_run_event_fields(db, input, event)),
  );
  return create_run_events(db, { ...input, events });
}

function is_stored_payload_row(row: RunEventPayload) {
  const metadata = row.metadata as { payload_shape?: unknown } | null | undefined;
  return metadata?.payload_shape === run_event_payload_shape;
}

export async function restore_run_event_payloads<T extends RunEventPayload>(
  db: Database,
  input: { workspace_id: string; rows: T[]; reading: RunEventPayloadReading },
): Promise<T[]> {
  const stored = input.rows.filter(is_stored_payload_row);
  if (stored.length === 0) return input.rows;

  const artifact_ids = stored.flatMap((row) =>
    payload_columns.flatMap((column) =>
      list_refs_inside(row[column]).map((ref) => ref.artifact_id),
    ),
  );
  const values =
    input.reading === 'load_full_value'
      ? await load_values_or_report(db, input.workspace_id, artifact_ids)
      : new Map<string, unknown>();
  return input.rows.map((row) => (is_stored_payload_row(row) ? restore_row(row, values) : row));
}

function restore_row<T extends RunEventPayload>(row: T, values: Map<string, unknown>): T {
  const restored: Record<string, unknown> = { ...row };
  for (const column of payload_columns) {
    if (row[column] === undefined) continue;
    restored[column] = order_keys_like_jsonb(
      put_values_back_inside(row[column], (_pointer, artifact_ref) =>
        values.has(artifact_ref.artifact_id)
          ? values.get(artifact_ref.artifact_id)
          : preview_marker(artifact_ref),
      ),
    );
  }
  if ('metadata' in row) {
    const { payload_shape: _shape, ...metadata } = row.metadata as Record<string, unknown>;
    restored.metadata = metadata;
  }
  return restored as T;
}

function preview_marker(artifact_ref: ArtifactRef) {
  return {
    wire_truncated: true,
    original_chars: artifact_ref.byte_size,
    preview: artifact_ref.preview,
  };
}

async function load_values_or_report(db: Database, workspace_id: string, artifact_ids: string[]) {
  try {
    const values = await load_stored_values(db, { workspace_id, artifact_ids });
    const missing = artifact_ids.filter((artifact_id) => !values.has(artifact_id));
    if (missing.length > 0) {
      log.error('Stored run event values are missing; their previews stand in.', {
        workspace_id,
        artifact_ids: missing,
      });
    }
    return values;
  } catch (error) {
    log.error('Reading stored run event values failed; their previews stand in.', {
      workspace_id,
      artifact_ids,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map<string, unknown>();
  }
}
