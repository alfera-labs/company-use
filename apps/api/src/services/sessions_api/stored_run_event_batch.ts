import type { Database } from '@coworker/core/db/connection';
import { list_run_events } from '@coworker/core/db/queries/sessions';
import { read_run_events } from '@runtime-platform/chat_stream/run_event_reads';

/** One page of a run's events, with the values stored in object storage read back. */
export async function list_restored_run_events(
  db: Database,
  workspace_id: string,
  run_id: string,
  page: { after_sequence: number; limit: number },
) {
  const rows = await list_run_events(db, workspace_id, run_id, page);
  return read_run_events(db, { workspace_id, rows, payload_reading: 'load_full_value' });
}
