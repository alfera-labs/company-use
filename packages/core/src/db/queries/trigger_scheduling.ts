import type { Database } from '@coworker/core/db/connection';
import { triggers, workspaces } from '@coworker/core/db/schema';
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

const scheduler_actor_id = 'system:scheduler';
const default_due_limit = 200;

export type DueScheduleTrigger = typeof triggers.$inferSelect;

export async function list_due_schedule_triggers(
  db: Database,
  input: { now: Date; limit?: number },
): Promise<DueScheduleTrigger[]> {
  return db
    .select()
    .from(triggers)
    .where(
      and(
        eq(triggers.trigger_type, 'schedule'),
        eq(triggers.trigger_status, 'enabled'),
        isNotNull(triggers.schedule_expression),
        or(isNull(triggers.next_run_time), lte(triggers.next_run_time, input.now)),
      ),
    )
    .orderBy(asc(triggers.next_run_time))
    .limit(input.limit ?? default_due_limit);
}

export async function claim_workspace_trigger_reconcile(
  db: Database,
  input: { workspace_id: string; reconcile_date: string; actor_id: string; reconcile_key?: string },
): Promise<boolean> {
  const reconcile_key = input.reconcile_key ?? input.reconcile_date;
  const rows = await db
    .update(workspaces)
    .set({
      workspace_data: input.reconcile_key
        ? sql`${workspaces.workspace_data} || jsonb_build_object('trigger_reconcile_date'::text, ${input.reconcile_date}::text, 'trigger_reconcile_key'::text, ${reconcile_key}::text)`
        : sql`${workspaces.workspace_data} || jsonb_build_object('trigger_reconcile_date'::text, ${input.reconcile_date}::text)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(workspaces.workspace_id, input.workspace_id),
        input.reconcile_key
          ? sql`coalesce(${workspaces.workspace_data} ->> 'trigger_reconcile_key', '') <> ${reconcile_key}::text`
          : sql`coalesce(${workspaces.workspace_data} ->> 'trigger_reconcile_date', '') <> ${input.reconcile_date}::text`,
      ),
    )
    .returning({ workspace_id: workspaces.workspace_id });

  return rows.length > 0;
}

export async function release_workspace_trigger_reconcile(
  db: Database,
  input: { workspace_id: string; reconcile_key: string; actor_id: string },
): Promise<void> {
  await db
    .update(workspaces)
    .set({
      workspace_data: sql`${workspaces.workspace_data} - 'trigger_reconcile_date' - 'trigger_reconcile_key'`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(workspaces.workspace_id, input.workspace_id),
        sql`coalesce(${workspaces.workspace_data} ->> 'trigger_reconcile_key', '') = ${input.reconcile_key}::text`,
      ),
    );
}

export async function record_trigger_fired(
  db: Database,
  input: { workspace_id: string; trigger_id: string; fired_time?: Date },
) {
  return db
    .update(triggers)
    .set({
      last_run_time: input.fired_time ?? new Date(),
      last_updated_time: new Date(),
      last_updated_by: scheduler_actor_id,
    })
    .where(
      and(eq(triggers.workspace_id, input.workspace_id), eq(triggers.trigger_id, input.trigger_id)),
    )
    .returning({ trigger_id: triggers.trigger_id });
}

export async function advance_trigger_schedule(
  db: Database,
  input: {
    workspace_id: string;
    trigger_id: string;
    next_run_time: Date;
    last_run_time?: Date | null;
  },
) {
  return db
    .update(triggers)
    .set({
      next_run_time: input.next_run_time,
      ...(input.last_run_time === undefined ? {} : { last_run_time: input.last_run_time }),
      last_updated_time: new Date(),
      last_updated_by: scheduler_actor_id,
    })
    .where(
      and(eq(triggers.workspace_id, input.workspace_id), eq(triggers.trigger_id, input.trigger_id)),
    )
    .returning();
}
