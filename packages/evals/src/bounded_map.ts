export async function map_with_concurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  map_item: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let next_index = 0;

  async function run_worker() {
    while (next_index < items.length) {
      const index = next_index;
      next_index += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await map_item(item, index);
    }
  }

  const worker_count = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: worker_count }, run_worker));
  return results;
}
