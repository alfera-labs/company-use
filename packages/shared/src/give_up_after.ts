/** The value of `answer`, or an error that names who was slow when the time limit comes first. */
export function give_up_after<T>(
  answer: Promise<T>,
  time_limit_ms: number,
  who_must_answer: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const time_limit = setTimeout(() => {
      reject(new Error(`${who_must_answer} did not answer within ${time_limit_ms} ms.`));
    }, time_limit_ms);
    answer.then(resolve, reject).finally(() => clearTimeout(time_limit));
  });
}
