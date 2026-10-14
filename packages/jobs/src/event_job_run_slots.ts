import { env } from '@coworker/config';
import { create_logger, is_session_queue_key } from '@coworker/shared';

const log = create_logger('event_job_runner');

type RunSlotPool = ReturnType<typeof create_run_slot_pool>;

function create_run_slot_pool(slot_name: string, read_max_runs: () => number) {
  let active_count = 0;
  let saturated = false;
  const waiters: Array<() => void> = [];

  async function take_slot(): Promise<void> {
    if (active_count < read_max_runs()) {
      active_count += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    return take_slot();
  }

  async function run<T>(run_one: () => Promise<T>, label: string): Promise<T> {
    const max_runs = read_max_runs();
    if (active_count >= max_runs) {
      if (!saturated) {
        saturated = true;
        log.info(`all ${max_runs} ${slot_name} slots busy — new work is queuing`);
      }
      log.debug(`${label} waiting for a ${slot_name} slot (${waiters.length + 1} in line)`);
    }
    await take_slot();
    log.debug(`${slot_name} slot taken by ${label} (${active_count}/${max_runs} in use)`);
    try {
      return await run_one();
    } finally {
      active_count -= 1;
      const wake_next_waiter = waiters.shift();
      if (wake_next_waiter) {
        wake_next_waiter();
      } else if (active_count === 0 && saturated) {
        saturated = false;
        log.info(`${slot_name} slots cleared — backlog drained`);
      }
    }
  }

  return { run };
}

let configured_max_background_runs: number | undefined;

export function configure_max_concurrent_queue_runs(max_runs: number | undefined) {
  configured_max_background_runs = max_runs;
}

const background_run_slots = create_run_slot_pool(
  'run',
  () => configured_max_background_runs ?? env.WORKER_MAX_CONCURRENT_RUNS,
);
const chat_run_slots = create_run_slot_pool('chat run', () => env.WORKER_MAX_CONCURRENT_CHAT_RUNS);

export function run_with_a_queue_run_slot<T>(
  run_one: () => Promise<T>,
  input: { label?: string; queue_key?: string } = {},
): Promise<T> {
  const pool: RunSlotPool =
    input.queue_key && is_session_queue_key(input.queue_key)
      ? chat_run_slots
      : background_run_slots;
  return pool.run(run_one, input.label ?? 'a queue');
}
