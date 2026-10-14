import type { Database } from '@coworker/core/db/connection';
import { runs } from '@coworker/core/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

/** True when any run of the agent is starting or running, so its sandbox may hold claims. */
export async function agent_has_live_run(
  db: Database,
  input: { workspace_id: string; agent_id: string },
) {
  const run = await db.query.runs.findFirst({
    columns: { run_id: true },
    where: and(
      eq(runs.workspace_id, input.workspace_id),
      eq(runs.agent_id, input.agent_id),
      inArray(runs.run_status, ['starting', 'running']),
    ),
  });
  return run !== undefined;
}
