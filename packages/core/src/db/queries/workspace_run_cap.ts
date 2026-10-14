import type { Database } from '@coworker/core/db/connection';
import { workspaces } from '@coworker/core/db/schema';
import { NotFoundError, ValidationError } from '@coworker/shared';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

export const workspace_max_concurrent_runs_schema = z.number().int().min(1).max(1000);

export async function set_workspace_max_concurrent_runs(
  db: Database,
  input: { workspace_id: string; max_concurrent_runs: unknown; actor_id: string },
) {
  const parsed = workspace_max_concurrent_runs_schema.safeParse(input.max_concurrent_runs);
  if (!parsed.success) {
    throw new ValidationError('max_concurrent_runs must be a whole number from 1 to 1000.', {
      max_concurrent_runs: input.max_concurrent_runs,
    });
  }

  const [workspace] = await db
    .update(workspaces)
    .set({
      metadata: sql`${workspaces.metadata} || jsonb_build_object('max_concurrent_runs', ${parsed.data}::int)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(workspaces.workspace_id, input.workspace_id))
    .returning({ workspace_id: workspaces.workspace_id });
  if (!workspace) throw new NotFoundError('Workspace');
  return { workspace_id: workspace.workspace_id, max_concurrent_runs: parsed.data };
}
