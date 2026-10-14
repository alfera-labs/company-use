import type { Database } from '@coworker/core/db/connection';
import { visible_to_reader } from '@coworker/core/db/queries/session_visibility';
import { runs, sessions } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

export async function get_run_for_user(
  db: Database,
  input: { workspace_id: string; run_id: string; user_id: string },
) {
  const [row] = await db
    .select({ run: runs })
    .from(runs)
    .innerJoin(
      sessions,
      and(eq(sessions.workspace_id, runs.workspace_id), eq(sessions.session_id, runs.session_id)),
    )
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        eq(runs.run_id, input.run_id),
        visible_to_reader(input.workspace_id, input.user_id),
      ),
    )
    .limit(1);
  return row?.run ?? null;
}
