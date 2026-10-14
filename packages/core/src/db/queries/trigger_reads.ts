import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { triggers, workspaces } from '@coworker/core/db/schema';
import { agent_heartbeat_job_handler } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

export async function list_triggers(db: Database, workspace_id: string) {
  return db.query.triggers.findMany({
    where: eq(triggers.workspace_id, workspace_id),
    orderBy: (table, { asc }) => [asc(table.created_time)],
  });
}

export async function list_agent_triggers(
  db: Database,
  input: { workspace_id: string; agent_id: string },
) {
  return db.query.triggers.findMany({
    where: and(
      eq(triggers.workspace_id, input.workspace_id),
      eq(triggers.agent_id, input.agent_id),
    ),
    orderBy: (table, { asc }) => [asc(table.created_time)],
  });
}

export async function list_workspace_schedule_triggers(db: DatabaseExecutor, workspace_id: string) {
  return db.query.triggers.findMany({
    where: and(eq(triggers.workspace_id, workspace_id), eq(triggers.trigger_type, 'schedule')),
    orderBy: (table, { asc }) => [asc(table.created_time)],
  });
}

export async function lock_workspace_trigger_changes(db: DatabaseExecutor, workspace_id: string) {
  await db.execute(
    sql`select 1 from ${workspaces} where ${workspaces.workspace_id} = ${workspace_id} for update`,
  );
}

export async function count_enabled_user_schedules(db: DatabaseExecutor, workspace_id: string) {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(triggers)
    .where(
      and(
        eq(triggers.workspace_id, workspace_id),
        eq(triggers.trigger_type, 'schedule'),
        eq(triggers.trigger_status, 'enabled'),
        sql`coalesce(${triggers.trigger_config}->>'starts_job_handler', '') <> ${agent_heartbeat_job_handler}`,
      ),
    );
  return row?.total ?? 0;
}

export async function get_trigger_by_id(db: DatabaseExecutor, trigger_id: string) {
  return (
    (await db.query.triggers.findFirst({ where: eq(triggers.trigger_id, trigger_id) })) ?? null
  );
}
