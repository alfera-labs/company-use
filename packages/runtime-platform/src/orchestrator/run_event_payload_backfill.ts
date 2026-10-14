import type { Database } from '@coworker/core';
import {
  type InlineRunEventCandidate,
  list_large_inline_run_events,
  set_run_event_payload,
} from '@coworker/core/db/queries/run_event_payload_moves';
import { is_large_value, large_value_threshold_bytes } from '@runtime-platform/files/stored_body';
import {
  move_large_run_event_fields,
  run_event_payload_shape,
} from '@runtime-platform/orchestrator/stored_run_event_payloads';
import { move_large_values_inside } from '@runtime-platform/tools/stored_tool_result_nested_values';

const system_actor_id = 'system';

export type RunEventPayloadBackfillOptions = { write: boolean; limit: number; batch_size: number };
type Totals = {
  looked_at: number;
  moved: number;
  unchanged: number;
  values: number;
  bytes: number;
};
type Options = RunEventPayloadBackfillOptions;

async function measure_values_to_move(row: InlineRunEventCandidate) {
  const sizes: number[] = [];
  const measure = async (value: unknown) => {
    if (is_large_value(value)) sizes.push(Buffer.byteLength(JSON.stringify(value)));
    return value;
  };
  await move_large_values_inside(row.event_data, measure);
  await move_large_values_inside(row.event_metadata, measure);
  return sizes;
}

async function move_row(db: Database, row: InlineRunEventCandidate) {
  const moved = await move_large_run_event_fields(
    db,
    {
      workspace_id: row.workspace_id,
      session_id: row.session_id,
      run_id: row.run_id,
      actor_id: system_actor_id,
    },
    row,
  );
  if (moved.metadata.payload_shape !== run_event_payload_shape) return 0;
  return set_run_event_payload(db, {
    run_event_id: row.run_event_id,
    event_data: moved.event_data,
    event_metadata: moved.event_metadata,
    metadata: moved.metadata,
    payload_shape: run_event_payload_shape,
    actor_id: system_actor_id,
  });
}

async function run_one_row(db: Database, options: Options, row: InlineRunEventCandidate) {
  const sizes = await measure_values_to_move(row);
  if (sizes.length === 0) return { moved: 0, sizes };
  const moved = options.write ? await move_row(db, row) : 1;
  return { moved, sizes };
}

function add_batch_results(totals: Totals, results: Awaited<ReturnType<typeof run_one_row>>[]) {
  for (const result of results) {
    totals[result.moved > 0 ? 'moved' : 'unchanged'] += 1;
    if (result.moved === 0) continue;
    totals.values += result.sizes.length;
    totals.bytes += result.sizes.reduce((sum, size) => sum + size, 0);
  }
}

async function backfill_batches_after(
  db: Database,
  options: Options,
  totals: Totals,
  after_run_event_id: string,
): Promise<string> {
  if (totals.looked_at >= options.limit) return after_run_event_id;
  const rows = await list_large_inline_run_events(db, {
    after_run_event_id,
    min_bytes: large_value_threshold_bytes,
    payload_shape: run_event_payload_shape,
    limit: Math.min(options.batch_size, options.limit - totals.looked_at),
  });
  if (rows.length === 0) return after_run_event_id;
  add_batch_results(totals, await Promise.all(rows.map((row) => run_one_row(db, options, row))));
  totals.looked_at += rows.length;
  return backfill_batches_after(
    db,
    options,
    totals,
    rows.at(-1)?.run_event_id ?? after_run_event_id,
  );
}

export async function backfill_run_event_payloads(db: Database, options: Options) {
  const totals: Totals = { looked_at: 0, moved: 0, unchanged: 0, values: 0, bytes: 0 };
  const last_run_event_id = await backfill_batches_after(db, options, totals, '');
  return { ...totals, last_run_event_id };
}
