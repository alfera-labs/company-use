import { create_logger, format_error_message } from '@coworker/shared';

const log = create_logger('run_background_writes');

const open_runs = new Map<string, Map<string, Promise<void>>>();

export function open_run_background_writes(run_id: string) {
  if (!open_runs.has(run_id)) open_runs.set(run_id, new Map());
}

export async function defer_run_write<T>(
  run_id: string,
  label: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  const queues = open_runs.get(run_id);
  if (!queues) return run_write_and_log_failure(run_id, label, work);

  const previous = queues.get(label) ?? Promise.resolve();
  queues.set(
    label,
    previous.then(async () => {
      await run_write_and_log_failure(run_id, label, work);
    }),
  );
  return undefined;
}

export async function settle_run_background_writes(run_id: string) {
  const queues = open_runs.get(run_id);
  if (!queues) return;
  open_runs.delete(run_id);
  await Promise.all(queues.values());
}

async function run_write_and_log_failure<T>(
  run_id: string,
  label: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    log.error('a run write after the tool result failed', {
      run_id,
      label,
      error: format_error_message(error),
    });
    return undefined;
  }
}
