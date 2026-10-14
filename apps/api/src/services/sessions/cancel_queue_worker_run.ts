import { get_queue_worker_client } from '@api/services/events/rivet_queue_worker_client';
import { check_again, repeat_until_done } from '@api/services/sessions/repeat_until_done';
import type { Database } from '@coworker/core';
import { withdraw_run_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import { get_run, request_run_cancellation } from '@coworker/core/db/queries/sessions';
import { find_running_event_job_for_run, queue_worker_lock_prefix } from '@coworker/jobs';
import { create_logger, NotFoundError } from '@coworker/shared';

const log = create_logger('cancel_queue_worker_run');
const stop_deadline_ms = 15_000;
const check_interval_ms = 200;
const run_end_statuses = new Set([
  'completed',
  'failed',
  'cancelled',
  'waiting',
  'blocked',
  'timed_out',
]);

type RunTarget = { workspace_id: string; run_id: string };

export async function find_queue_worker_running(db: Database, target: RunTarget) {
  if (!get_queue_worker_client()) return null;
  const job = await find_running_event_job_for_run(db, target);
  if (!job?.locked_by?.startsWith(queue_worker_lock_prefix)) return null;
  return job.queue_key;
}

export async function cancel_queue_worker_run(
  db: Database,
  input: RunTarget & { actor_id: string; queue_key: string },
) {
  await request_run_cancellation(db, input.workspace_id, input.run_id, input.actor_id);
  await ask_queue_worker_to_stop(input);
  const run = await wait_for_run_to_end(db, input);
  await withdraw_run_tool_policy_waits(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
  });
  return run;
}

async function ask_queue_worker_to_stop(input: RunTarget & { queue_key: string }) {
  const client = get_queue_worker_client();
  if (!client) return;
  try {
    const queue = { workspace_id: input.workspace_id, queue_key: input.queue_key };
    const result = await client.cancel_run(queue, input.run_id);
    log.info(`queue worker answered the cancel of ${input.run_id}: ${JSON.stringify(result)}`);
  } catch (error) {
    log.warn('the queue worker did not take the cancel; the run cancel poll will stop the run', {
      run_id: input.run_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function wait_for_run_to_end(db: Database, target: RunTarget) {
  const deadline = Date.now() + stop_deadline_ms;
  return repeat_until_done(async () => {
    const run = await get_run(db, target.workspace_id, target.run_id);
    if (!run) throw new NotFoundError('Run');
    if (run_end_statuses.has(run.run_status)) return { done: true, value: run };
    if (Date.now() >= deadline) {
      log.warn(`run ${target.run_id} did not stop within 15s of cancellation in its queue worker`);
      return { done: true, value: run };
    }
    return check_again;
  }, check_interval_ms);
}
