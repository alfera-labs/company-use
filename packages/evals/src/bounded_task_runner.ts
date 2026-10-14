import { map_with_concurrency } from '@coworker/evals/bounded_map';

export async function run_tasks_with_concurrency<TItem>(
  items: TItem[],
  concurrency: number,
  run_task: (item: TItem, index: number) => Promise<void>,
) {
  let first_failure: unknown;
  let task_failed = false;
  await map_with_concurrency(items, concurrency, async (item, index) => {
    if (task_failed) return;
    try {
      await run_task(item, index);
    } catch (error) {
      if (!task_failed) first_failure = error;
      task_failed = true;
    }
  });
  if (task_failed) throw first_failure;
}
