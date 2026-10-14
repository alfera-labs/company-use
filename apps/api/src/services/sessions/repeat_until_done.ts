export type CheckAnswer<T> = { done: true; value: T } | { done: false };

export const check_again: CheckAnswer<never> = { done: false };

/**
 * Runs `check`, then runs it again `interval_ms` after each answer that is not done.
 * The next check is a scheduled step, so a poll that lasts hours holds no growing chain.
 */
export function repeat_until_done<T>(
  check: () => Promise<CheckAnswer<T>>,
  interval_ms: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run_check = () => {
      check().then((answer) => {
        if (answer.done) resolve(answer.value);
        else setTimeout(run_check, interval_ms);
      }, reject);
    };
    run_check();
  });
}
