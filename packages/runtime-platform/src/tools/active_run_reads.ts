import type { Database } from '@coworker/core';
import { list_visible_active_runs } from '@coworker/core/db/queries/visible_sessions';
import { summarize_active_run } from '@runtime-platform/tools/definitions/sessions_support';

/** Lists the runs going now in the conversations this reader may read, as run summaries. */
export async function list_active_runs_for_reader(
  db: Database,
  input: { workspace_id: string; reader_user_id: string; limit: number },
) {
  const rows = await list_visible_active_runs(db, input);
  return rows.map(summarize_active_run);
}
