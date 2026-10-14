import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { automations, triggers } from '@coworker/core/db/schema';
import { and, count, eq, isNotNull, notInArray, sql } from 'drizzle-orm';

export async function list_automation_triggers(
  db: DatabaseExecutor,
  input: { workspace_id: string; automation_id: string },
) {
  return db
    .select()
    .from(triggers)
    .where(
      and(
        eq(triggers.workspace_id, input.workspace_id),
        eq(triggers.automation_id, input.automation_id),
      ),
    )
    .orderBy(triggers.created_time);
}

export async function list_automation_triggers_for_workspace(db: Database, workspace_id: string) {
  return db
    .select()
    .from(triggers)
    .where(and(eq(triggers.workspace_id, workspace_id), isNotNull(triggers.automation_id)))
    .orderBy(triggers.created_time);
}

export async function count_open_provider_triggers(db: DatabaseExecutor, workspace_id: string) {
  const [row] = await db
    .select({ total: count() })
    .from(triggers)
    .leftJoin(automations, eq(automations.automation_id, triggers.automation_id))
    .where(
      and(
        eq(triggers.workspace_id, workspace_id),
        eq(triggers.trigger_type, 'app_event'),
        notInArray(triggers.trigger_status, ['disabled', 'error']),
        sql`${triggers.trigger_config} -> 'event_source' ->> 'trigger_slug' is not null`,
        sql`${automations.created_via} is distinct from 'system'`,
      ),
    );
  return row?.total ?? 0;
}
