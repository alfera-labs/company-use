import { capture_worker_exception } from '@worker/worker_sentry';
import type { WorkerServices } from '@worker/worker_services';

export function start_repeating_task(
  services: WorkerServices,
  task: { task_name: string; interval_ms: number; run: () => Promise<unknown> },
) {
  let running = false;
  const run_once = () => {
    if (running) return;
    running = true;
    task
      .run()
      .catch((error) => {
        services.log.error(`the ${task.task_name} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
        capture_worker_exception(error, { failure: task.task_name });
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(run_once, task.interval_ms);
  if (typeof timer.unref === 'function') timer.unref();
  run_once();
  return () => clearInterval(timer);
}
