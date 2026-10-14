import type { Database } from '@coworker/core';
import { release_waiting_run } from '@coworker/core/db/queries/run_suspension';
import type { EventJobHandlerResult } from '@coworker/jobs';

export const wait_expiry_actor_id = 'system:wait_expiry';

/** A step the deadline refused closes here: nobody answered, so no run starts in the old chat. */
export function closed_by_expiry(
  actor_key: string,
  calls_refused: number,
): EventJobHandlerResult | null {
  if (actor_key !== wait_expiry_actor_id) return null;
  return { job_status: 'done', result_data: { nobody_answered: true, calls_refused } };
}

export async function release_if_still_waiting(
  input: { db: Database; workspace_id: string },
  job: { job_id: string },
  asking_run: { waiting_on_job_id: string | null } | null | undefined,
  step: { wait: { source_run_id: string }; decision_event: { actor_key: string } },
) {
  if (asking_run?.waiting_on_job_id !== job.job_id) return;
  await release_waiting_run(input.db, {
    workspace_id: input.workspace_id,
    run_id: step.wait.source_run_id,
    actor_id: step.decision_event.actor_key,
  });
}
