import {
  cancel_queue_worker_run,
  find_queue_worker_running,
} from '@api/services/sessions/cancel_queue_worker_run';
import type { Database } from '@coworker/core';
import { pause_queued_session_messages } from '@coworker/core/db/queries/session_message_queue';
import { get_run } from '@coworker/core/db/queries/sessions';
import { cancel_agent_run } from '@coworker/runtime-platform';
import { NotFoundError } from '@coworker/shared';

const active_run_statuses = new Set(['queued', 'starting', 'running', 'waiting']);

export async function stop_session_run(
  db: Database,
  input: { workspace_id: string; run_id: string; actor_id: string },
) {
  const run = await get_run(db, input.workspace_id, input.run_id);
  if (!run) throw new NotFoundError('Run');
  if (active_run_statuses.has(run.run_status)) {
    await pause_queued_session_messages(db, {
      workspace_id: input.workspace_id,
      session_id: run.session_id,
      actor_id: input.actor_id,
    });
  }
  return cancel_session_run(db, input);
}

export async function cancel_session_run(
  db: Database,
  input: { workspace_id: string; run_id: string; actor_id: string },
) {
  const queue_key = await find_queue_worker_running(db, input);
  if (queue_key) return cancel_queue_worker_run(db, { ...input, queue_key });
  return cancel_agent_run(db, input);
}
