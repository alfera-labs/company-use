import { connector_canary_app_keys } from '@coworker/config';
import { find_next_due_work_time } from '@coworker/core/db/queries/due_work_time';
import { read_clock_key } from '@coworker/jobs';
import { run_clock_work } from '@worker/clock_work';
import { stale_wake_seconds } from '@worker/queue_sweep';
import { create_queue_worker_ring, type QueueWorkerLookup } from '@worker/queue_worker_ring';
import { capture_worker_exception } from '@worker/worker_sentry';
import type { WorkerServices } from '@worker/worker_services';
import { actor } from 'rivetkit';
import { UserError } from 'rivetkit/errors';

const retry_failed_work_ms = 60_000;
const day_ms = 24 * 60 * 60_000;

type ClockContext = {
  key: string[];
  conn?: unknown;
  cron: { list(): Promise<Array<{ name: string }>>; delete(name: string): Promise<boolean> };
  schedule: {
    list(): Promise<Array<{ id: string; runAt: number }>>;
    cancel(id: string): Promise<boolean>;
    at(timestamp: number, action: string, ...args: unknown[]): Promise<string>;
  };
  client(): unknown;
};

export function create_clock_actor(services: WorkerServices) {
  const run_alone = create_run_alone(services);
  return actor({
    actions: {
      arm: (c, wake_by_ms?: number) => arm_clock(services, c, 0, wake_by_ms),
      wake: async (c, due_ms: number) => {
        refuse_client_call(services, c);
        const ring = create_queue_worker_ring(c.client() as QueueWorkerLookup, services);
        await run_alone(() => run_clock_work(services, ring, new Date(due_ms)));
        return arm_clock(services, c, retry_failed_work_ms);
      },
    },
  });
}

async function arm_clock(
  services: WorkerServices,
  c: ClockContext,
  past_due_delay_ms: number,
  wake_by_ms?: number,
) {
  read_own_clock_key(services, c.key);
  await delete_crons_in_order(c, await c.cron.list());
  const now_ms = services.now().getTime();
  const due_ms = await find_due_ms(services, now_ms, wake_by_ms);
  const wake_ms = due_ms === null || due_ms > now_ms ? due_ms : now_ms + past_due_delay_ms;
  const alarms = await c.schedule.list();
  const earlier = alarms.find((alarm) => alarm.runAt > now_ms && alarm.runAt <= (wake_ms ?? 0));
  if (earlier) return earlier.runAt;
  await cancel_alarms_in_order(c, alarms);
  if (wake_ms !== null) await c.schedule.at(wake_ms, 'wake', wake_ms);
  return wake_ms;
}

async function delete_crons_in_order(c: ClockContext, crons: Array<{ name: string }>) {
  const [cron, ...rest] = crons;
  if (!cron) return;
  await c.cron.delete(cron.name);
  await delete_crons_in_order(c, rest);
}

async function cancel_alarms_in_order(c: ClockContext, alarms: Array<{ id: string }>) {
  const [alarm, ...rest] = alarms;
  if (!alarm) return;
  await c.schedule.cancel(alarm.id);
  await cancel_alarms_in_order(c, rest);
}

async function find_due_ms(services: WorkerServices, now_ms: number, wake_by_ms?: number) {
  const due_work = await find_next_due_work_time(services.db, {
    stale_wake_ms: stale_wake_seconds * 1000,
  });
  const due_times = [
    due_work?.getTime(),
    wake_by_ms,
    connector_canary_app_keys().length > 0 ? Math.ceil((now_ms + 1) / day_ms) * day_ms : undefined,
  ].filter((time): time is number => time !== undefined);
  return due_times.length > 0 ? Math.min(...due_times) : null;
}

function refuse_client_call(services: WorkerServices, c: ClockContext) {
  read_own_clock_key(services, c.key);
  if (c.conn) throw new UserError('Only the clock alarm runs this.', { code: 'forbidden' });
}

function read_own_clock_key(services: WorkerServices, key: string[]) {
  try {
    return read_clock_key(key, services.rivet_key_scope);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error), {
      code: 'clock_key_refused',
    });
  }
}

function create_run_alone(services: WorkerServices) {
  let running = false;
  let run_after_this_one: (() => Promise<unknown>) | undefined;
  return async (run: () => Promise<unknown>) => {
    if (running) {
      run_after_this_one = run;
      return;
    }
    running = true;
    try {
      await run_until_none_is_waiting(run);
    } finally {
      running = false;
    }
  };

  async function run_until_none_is_waiting(run: () => Promise<unknown>) {
    await run_and_report_failure(services, run);
    const next = run_after_this_one;
    run_after_this_one = undefined;
    if (next) await run_until_none_is_waiting(next);
  }
}

async function run_and_report_failure(services: WorkerServices, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    services.log.error('the clock work failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    capture_worker_exception(error, { failure: 'clock_work' });
  }
}
