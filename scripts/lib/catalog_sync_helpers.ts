// The plumbing both catalog syncs need: reading their own flags, batching rows for one multi-row
// statement, and pacing provider calls. No provider knowledge and no database handle — a sync
// script imports these so the two scripts read the same way.

export function batches_of<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A fixed pool of workers pulling from one list, so a slow toolkit never holds up the rest of a
// batch the way `Promise.all` over fixed slices does.
export async function run_with_concurrency<T>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<void>,
) {
  let next_index = 0;
  async function worker() {
    while (next_index < items.length) {
      const index = next_index;
      next_index += 1;
      await run(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// `--toolkit a --toolkit b` reads as both values, so a flag can be repeated.
export function read_all_flags(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]!);
  }
  return values;
}

export function read_optional_int(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = Number.parseInt(args[index + 1] ?? '', 10);
  return Number.isFinite(value) ? value : undefined;
}
