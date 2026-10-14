import type { Plan } from '@coworker/config/plans';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { workspace_members, workspaces } from '@coworker/core/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export async function find_workspace_plan(
  _db: DatabaseExecutor,
  _workspace_id: string,
): Promise<Plan | undefined> {
  return undefined;
}

export async function lock_workspace_plan_capacity(db: DatabaseExecutor, workspace_id: string) {
  await db.execute(
    sql`select 1 from ${workspaces} where ${workspaces.workspace_id} = ${workspace_id} for update`,
  );
}

export async function count_active_workspace_members(db: DatabaseExecutor, workspace_id: string) {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_status, 'active'),
      ),
    );
  return row?.total ?? 0;
}
