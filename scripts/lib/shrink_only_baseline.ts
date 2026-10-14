import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A shrink-only baseline records known debt as `file -> count`. A file may keep its debt or pay
// it down; it may not add more, and a file that is not in the baseline may have none at all.
// `--update` only ever lowers a count or drops a paid-off file, so the baseline cannot be used to
// quietly accept new debt — accepting new debt means editing the JSON by hand, in review.
export type ShrinkOnlyBaseline = Record<string, number>;

export type BaselineBreach = {
  repository_path: string;
  allowed: number;
  current: number;
};

export function read_baseline(baseline_path: string): ShrinkOnlyBaseline {
  return JSON.parse(readFileSync(baseline_path, 'utf8')) as ShrinkOnlyBaseline;
}

export function write_baseline(baseline_path: string, baseline: ShrinkOnlyBaseline) {
  const sorted = Object.fromEntries(
    Object.entries(baseline).sort(([left], [right]) => left.localeCompare(right)),
  );
  writeFileSync(baseline_path, `${JSON.stringify(sorted, null, 2)}\n`);
}

// `current` holds only files that have debt; a file absent from it has none.
export function find_baseline_breaches(baseline: ShrinkOnlyBaseline, current: ShrinkOnlyBaseline) {
  const breaches: BaselineBreach[] = [];
  for (const [repository_path, count] of Object.entries(current)) {
    const allowed = baseline[repository_path] ?? 0;
    if (count > allowed) breaches.push({ repository_path, allowed, current: count });
  }
  return breaches;
}

export function shrink_baseline(baseline: ShrinkOnlyBaseline, current: ShrinkOnlyBaseline) {
  const shrunk: ShrinkOnlyBaseline = {};
  for (const [repository_path, allowed] of Object.entries(baseline)) {
    const count = current[repository_path] ?? 0;
    if (count > 0) shrunk[repository_path] = Math.min(allowed, count);
  }
  return shrunk;
}

export function assert_shrink_only_baseline_works() {
  const breaches = find_baseline_breaches(
    { 'kept.ts': 3, 'paid.ts': 2 },
    { 'kept.ts': 4, 'new.ts': 1, 'paid.ts': 1 },
  );
  const reported = breaches.map((breach) => breach.repository_path).join(',');
  if (reported !== 'kept.ts,new.ts') {
    throw new Error(`self-test: baseline breaches were ${reported}, expected kept.ts,new.ts`);
  }
  const shrunk = shrink_baseline({ 'kept.ts': 3, 'paid.ts': 2 }, { 'kept.ts': 5, 'new.ts': 9 });
  if (JSON.stringify(shrunk) !== '{"kept.ts":3}') {
    throw new Error(`self-test: --update grew or kept stale debt: ${JSON.stringify(shrunk)}`);
  }
}

// Writes the first baseline for a new guard. Refuses when one exists, so it can never be used to
// accept new debt later — that path is `--update`, which only shrinks.
export function create_first_baseline(baseline_path: string, current: ShrinkOnlyBaseline) {
  if (existsSync(baseline_path)) {
    throw new Error(`${baseline_path} already exists. Use --update, which can only shrink it.`);
  }
  mkdirSync(dirname(baseline_path), { recursive: true });
  write_baseline(baseline_path, current);
  console.log(`baseline created at ${baseline_path} with ${Object.keys(current).length} files`);
}
