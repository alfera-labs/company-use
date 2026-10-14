import type { Database } from '@coworker/core/db/connection';
import {
  type AutomationFire,
  type AutomationFireTold,
  read_automation_fire,
} from '@coworker/core/db/queries/automation_fire_reading';
import {
  list_notifications_by_run_ids,
  type NotificationPageItem,
} from '@coworker/core/db/queries/notification_outcomes';
import { event_jobs, events, runs, triggers } from '@coworker/core/db/schema';
import { action_asks_the_person } from '@coworker/core/db/schema/automation_contracts';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

export async function list_automation_fire_page(
  db: Database,
  input: { workspace_id: string; automation_id: string; page: number; page_size: number },
) {
  // The trigger id is a JSON field on the event, so this join cannot use an index on it.
  // An automation's own fires are a small set; if a workspace ever pages millions, stamp automation_id on
  // the event body and index it.
  const where = and(
    eq(events.workspace_id, input.workspace_id),
    eq(events.source, 'trigger'),
    eq(triggers.automation_id, input.automation_id),
  );
  const [total_row, rows] = await Promise.all([
    db
      .select({ total_count: count() })
      .from(events)
      .innerJoin(triggers, fire_belongs_to_trigger)
      .where(where),
    select_fire_rows(db)
      .where(where)
      .orderBy(desc(events.created_time), desc(events.event_id))
      .limit(input.page_size)
      .offset((input.page - 1) * input.page_size),
  ]);

  return {
    items: await attach_what_the_runs_told_you(
      db,
      input.workspace_id,
      rows.map(read_automation_fire),
    ),
    total_count: total_row[0]?.total_count ?? 0,
    page: input.page,
    page_size: input.page_size,
  };
}

const fire_belongs_to_trigger = and(
  eq(triggers.workspace_id, events.workspace_id),
  sql`${triggers.trigger_id} = ${events.event_body} ->> 'trigger_id'`,
);

function select_fire_rows(db: Database) {
  const triage_event = alias(events, 'triage_event');
  const triage_job = alias(event_jobs, 'triage_job');
  return db
    .select({
      event_id: events.event_id,
      fired_time: events.created_time,
      trigger_id: triggers.trigger_id,
      trigger_name: triggers.trigger_name,
      job_status: event_jobs.job_status,
      result_data: event_jobs.result_data,
      error_data: event_jobs.error_data,
      run_id: event_jobs.run_id,
      run_session_id: runs.session_id,
      run_status: runs.run_status,
      triage_result: triage_job.result_data,
    })
    .from(events)
    .innerJoin(triggers, fire_belongs_to_trigger)
    .leftJoin(
      event_jobs,
      and(
        eq(event_jobs.workspace_id, events.workspace_id),
        eq(event_jobs.event_id, events.event_id),
        eq(event_jobs.job_handler, 'run_automation'),
      ),
    )
    .leftJoin(
      runs,
      and(eq(runs.workspace_id, event_jobs.workspace_id), eq(runs.run_id, event_jobs.run_id)),
    )
    .leftJoin(
      triage_event,
      and(
        eq(triage_event.workspace_id, events.workspace_id),
        eq(triage_event.source, 'triage'),
        eq(triage_event.source_event_id, events.event_id),
      ),
    )
    .leftJoin(
      triage_job,
      and(
        eq(triage_job.workspace_id, events.workspace_id),
        eq(triage_job.event_id, triage_event.event_id),
        eq(triage_job.job_handler, 'triage_signal'),
      ),
    );
}

async function attach_what_the_runs_told_you(
  db: Database,
  workspace_id: string,
  fires: AutomationFire[],
): Promise<AutomationFire[]> {
  const run_ids = [...new Set(fires.map((fire) => fire.run_id).filter((id) => id !== null))];
  const notifications = await list_notifications_by_run_ids(db, { workspace_id, run_ids });
  const told_by_run = new Map(
    notifications.map((notification) => [
      notification.notification.run_id,
      read_told(notification),
    ]),
  );
  return fires.map((fire) => ({
    ...fire,
    told: (fire.run_id ? told_by_run.get(fire.run_id) : null) ?? null,
  }));
}

function read_told(row: NotificationPageItem): AutomationFireTold {
  return {
    notification_event_id: row.event_id,
    title: row.notification.title,
    outcome: row.outcome,
    outcome_reason: row.notification.outcome_reason,
    held: row.notification.held,
    delivered_on: row.notification.delivered_on,
    delivery_error: row.notification.delivery_error,
    asks_the_person: action_asks_the_person(row.notification.proposed_action.kind),
    open: row.is_open,
  };
}

export async function count_automation_fires_today(
  db: Database,
  input: { workspace_id: string; automation_id: string; now: Date; budget_reset_time?: Date },
): Promise<number> {
  const midnight = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate(),
  );
  const day_start = new Date(Math.max(midnight, input.budget_reset_time?.getTime() ?? 0));
  const [row] = await db
    .select({ total_count: count() })
    .from(events)
    .innerJoin(triggers, fire_belongs_to_trigger)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, 'trigger'),
        eq(triggers.automation_id, input.automation_id),
        gte(events.created_time, day_start),
      ),
    );
  return row?.total_count ?? 0;
}
