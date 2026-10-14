import type { Database } from '@coworker/core';
import { list_blocking_connection_resume_batches } from '@coworker/core/db/queries/connection_resume_state';
import { list_runs_by_ids } from '@coworker/core/db/queries/sessions';

const origin_run_recheck_ms = 1_000;

const open_run_statuses = ['queued', 'starting', 'running', 'waiting'];

export type ConnectionResumeBatchGate = {
  blocked_batch_ids: Set<string>;
  retry_at: Date | null;
};

export async function read_connection_resume_batch_gate(
  db: Database,
  input: { workspace_id: string; batch_ids: string[]; now: Date },
): Promise<ConnectionResumeBatchGate> {
  if (input.batch_ids.length === 0) {
    return { blocked_batch_ids: new Set(), retry_at: null };
  }

  const origin_runs = await list_runs_by_ids(db, input.workspace_id, input.batch_ids);
  if (origin_runs.some((run) => open_run_statuses.includes(run.run_status))) {
    return {
      blocked_batch_ids: new Set(),
      retry_at: new Date(input.now.getTime() + origin_run_recheck_ms),
    };
  }

  const blocked = await list_blocking_connection_resume_batches(db, {
    workspace_id: input.workspace_id,
    batch_ids: input.batch_ids,
  });
  return { blocked_batch_ids: new Set(blocked), retry_at: null };
}
