import type { Database } from '@coworker/core/db/connection';
import { runs } from '@coworker/core/db/schema';
import { and, count, eq, inArray } from 'drizzle-orm';

export async function count_trigger_runs(
  db: Database,
  input: { workspace_id: string; trigger_ids: string[] },
) {
  if (input.trigger_ids.length === 0) return new Map<string, number>();
  const counts = await db
    .select({ trigger_id: runs.trigger_id, run_count: count() })
    .from(runs)
    .where(
      and(eq(runs.workspace_id, input.workspace_id), inArray(runs.trigger_id, input.trigger_ids)),
    )
    .groupBy(runs.trigger_id);
  return new Map(counts.map((row) => [row.trigger_id, row.run_count]));
}
