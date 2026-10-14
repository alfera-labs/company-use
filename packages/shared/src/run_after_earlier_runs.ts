type RunsOfOneKey = { last_run_is_over: Promise<void>; runs_not_over: number };

const runs_by_key = new Map<string, RunsOfOneKey>();

/**
 * Runs work that shares a key one at a time, in the order of the calls, in this process. Work
 * under another key does not wait. A run that fails does not stop the runs behind it.
 */
export async function run_after_earlier_runs<T>(key: string, work: () => Promise<T>): Promise<T> {
  const runs = runs_by_key.get(key) ?? { last_run_is_over: Promise.resolve(), runs_not_over: 0 };
  runs_by_key.set(key, runs);
  const earlier_runs_are_over = runs.last_run_is_over;
  let mark_this_run_over = () => {};
  runs.last_run_is_over = new Promise<void>((resolve) => {
    mark_this_run_over = resolve;
  });
  runs.runs_not_over += 1;

  await earlier_runs_are_over;
  try {
    return await work();
  } finally {
    runs.runs_not_over -= 1;
    if (runs.runs_not_over === 0) runs_by_key.delete(key);
    mark_this_run_over();
  }
}
