import { hostname } from 'node:os';
import { expire_stale_pending_connection_setups } from '@coworker/core/db/queries/connection_management';
import { claim_scheduler_tick } from '@coworker/core/db/queries/scheduler_ticks';
import { recover_stale_running_runs } from '@coworker/core/db/queries/sessions';
import {
  fire_due_schedules_and_expire_waits,
  run_minute_maintenance,
} from '@coworker/runtime-platform';
import { start_resumes_for_expired_connection_setups } from '@runtime-platform/connections/connection_resume_activation';
import { sweep_queues } from '@worker/queue_sweep';
import type { RingQueueWorker } from '@worker/queue_worker_ring';
import { sweep_finished_team_sign_ins } from '@worker/team_sign_in_sweep';
import { capture_worker_exception } from '@worker/worker_sentry';
import type { WorkerServices } from '@worker/worker_services';

export const clock_work_tick_name = 'clock_work';
const worker_actor_id = `system:worker:${hostname()}:${process.pid}`;

const clock_work = {
  sweep_queues: (services: WorkerServices, ring: RingQueueWorker) => sweep_queues(services, ring),
  fire_due_schedules_and_expire_waits: (services: WorkerServices) =>
    fire_due_schedules_and_expire_waits(services.db),
  run_minute_maintenance: (services: WorkerServices) => run_minute_maintenance(services.db),
  recover_stale_running_runs: (services: WorkerServices) => recover_stale_running_runs(services.db),
  sweep_finished_team_sign_ins: (services: WorkerServices) =>
    sweep_finished_team_sign_ins(services.db),
  expire_stale_pending_connection_setups: async (services: WorkerServices) =>
    start_resumes_for_expired_connection_setups(
      services.db,
      await expire_stale_pending_connection_setups(services.db),
    ),
} as const;

export async function run_clock_work(
  services: WorkerServices,
  ring: RingQueueWorker,
  due_time: Date,
): Promise<boolean> {
  const claimed = await claim_scheduler_tick(services.db, {
    tick_name: clock_work_tick_name,
    tick_time: due_time,
    actor_id: worker_actor_id,
  });
  if (!claimed) return false;
  const parts = Object.entries(clock_work);
  const results = await Promise.allSettled(parts.map(([, run]) => run(services, ring)));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    const part_name = parts[index]?.[0] ?? 'unknown';
    services.log.error(`the clock work part ${part_name} failed`, {
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    capture_worker_exception(result.reason, { failure: `clock_work_${part_name}` });
  });
  services.log.info(`the clock ran the work due at ${due_time.toISOString()}`);
  return true;
}
