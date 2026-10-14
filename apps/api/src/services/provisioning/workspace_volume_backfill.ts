import { type Database, volumes, workspaces } from '@coworker/core';
import { provision_volume } from '@coworker/runtime-platform';
import { format_error_message, map_with_concurrency } from '@coworker/shared';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';

const backfill_actor = 'system:workspace_volume_backfill';

export async function read_workspace_volume_rollout(db: Database) {
  const [summary] = await db
    .select({
      active_workspaces: sql<number>`count(*)::int`,
      active_volumes: sql<number>`count(*) filter (where ${volumes.volume_status} = 'active')::int`,
      workspaces_needing_volume: sql<number>`count(*) filter (where ${volumes.volume_id} is null or ${volumes.volume_status} <> 'active')::int`,
    })
    .from(workspaces)
    .leftJoin(volumes, eq(volumes.workspace_id, workspaces.workspace_id))
    .where(eq(workspaces.workspace_status, 'active'));
  return (
    summary ?? {
      active_workspaces: 0,
      active_volumes: 0,
      workspaces_needing_volume: 0,
    }
  );
}

export async function run_workspace_volume_backfill(
  db: Database,
  input: { limit: number; concurrency: number },
) {
  const workspace_ids = await list_workspace_ids_needing_volume(db, input.limit);
  const results = await map_with_concurrency(workspace_ids, input.concurrency, (workspace_id) =>
    provision_workspace_volume(db, workspace_id),
  );
  const failures = results.flatMap((result) => (result.error ? [result] : []));
  return {
    workspaces_checked: workspace_ids.length,
    volumes_provisioned: results.length - failures.length,
    volumes_failed: failures.length,
    failures,
  };
}

async function list_workspace_ids_needing_volume(db: Database, limit: number) {
  const rows = await db
    .select({ workspace_id: workspaces.workspace_id })
    .from(workspaces)
    .leftJoin(volumes, eq(volumes.workspace_id, workspaces.workspace_id))
    .where(
      and(
        eq(workspaces.workspace_status, 'active'),
        or(isNull(volumes.volume_id), ne(volumes.volume_status, 'active')),
      ),
    )
    .orderBy(asc(workspaces.created_time))
    .limit(limit);
  return rows.map((row) => row.workspace_id);
}

async function provision_workspace_volume(db: Database, workspace_id: string) {
  try {
    await provision_volume(db, { workspace_id, actor_id: backfill_actor });
    return { workspace_id };
  } catch (error) {
    return {
      workspace_id,
      error: format_error_message(error),
    };
  }
}
