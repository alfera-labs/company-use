export async function map_with_concurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  operation: (item: TInput) => Promise<TOutput>,
  options: { after_batch?: (completed_count: number) => Promise<void> } = {},
) {
  const results: TOutput[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(operation))));
    await options.after_batch?.(results.length);
  }
  return results;
}
