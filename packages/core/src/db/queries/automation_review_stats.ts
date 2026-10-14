import type { Database } from '@coworker/core/db/connection';
import { read_automation_fire } from '@coworker/core/db/queries/automation_fire_reading';
import {
  policy_decision_event_type,
  policy_decision_job_handler,
} from '@coworker/core/db/queries/event_waits';
import {
  notification_event_type,
  notification_follow_up_event_type,
  notification_source,
} from '@coworker/core/db/queries/notification_outcomes';
import { automations, event_jobs, events, runs, triggers } from '@coworker/core/db/schema';
import type { NotificationOutcome } from '@coworker/core/db/schema/automation_contracts';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

// Counted in TypeScript over one workspace's week, a few hundred rows.

export type AutomationWeekReview = {
  automation_id: string;
  automation_name: string;
  fires: number;
  ran: number;
  skipped_by_stage: Record<string, number>;
  notifications: number;
  notifications_by_end: { open: number; acted: number; dismissed: number; expired: number };
  approvals_answered_yes: number;
  approvals_answered_no: number;
};

type Scope = { workspace_id: string; automation_ids: string[]; since: Date };
type WeekByAutomation = Map<string, AutomationWeekReview>;

const review_window_days = 7;

export async function list_automation_review_stats(
  db: Database,
  input: { workspace_id: string; now?: Date | undefined; days?: number | undefined },
): Promise<AutomationWeekReview[]> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (input.days ?? review_window_days) * 86_400_000);
  const enabled = await db
    .select({
      automation_id: automations.automation_id,
      automation_name: automations.automation_name,
    })
    .from(automations)
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_status, 'enabled'),
      ),
    );
  if (enabled.length === 0) return [];

  const weeks: WeekByAutomation = new Map(
    enabled.map((automation) => [automation.automation_id, blank_week(automation)]),
  );
  const scope: Scope = {
    workspace_id: input.workspace_id,
    automation_ids: [...weeks.keys()],
    since,
  };
  await Promise.all([
    count_fires(db, scope, weeks),
    count_notifications(db, scope, weeks),
    count_answered_approvals(db, scope, weeks),
  ]);
  return [...weeks.values()];
}

function blank_week(automation: { automation_id: string; automation_name: string }) {
  return {
    ...automation,
    fires: 0,
    ran: 0,
    skipped_by_stage: {},
    notifications: 0,
    notifications_by_end: { open: 0, acted: 0, dismissed: 0, expired: 0 },
    approvals_answered_yes: 0,
    approvals_answered_no: 0,
  };
}

async function count_fires(db: Database, scope: Scope, weeks: WeekByAutomation) {
  const rows = await db
    .select({
      automation_id: triggers.automation_id,
      event_id: events.event_id,
      fired_time: events.created_time,
      trigger_id: triggers.trigger_id,
      trigger_name: triggers.trigger_name,
      job_status: event_jobs.job_status,
      result_data: event_jobs.result_data,
      error_data: event_jobs.error_data,
      run_id: event_jobs.run_id,
    })
    .from(events)
    .innerJoin(
      triggers,
      and(
        eq(triggers.workspace_id, events.workspace_id),
        sql`${triggers.trigger_id} = ${events.event_body} ->> 'trigger_id'`,
      ),
    )
    .leftJoin(
      event_jobs,
      and(
        eq(event_jobs.workspace_id, events.workspace_id),
        eq(event_jobs.event_id, events.event_id),
        eq(event_jobs.job_handler, 'run_automation'),
      ),
    )
    .where(
      and(
        eq(events.workspace_id, scope.workspace_id),
        eq(events.source, 'trigger'),
        gte(events.created_time, scope.since),
        inArray(triggers.automation_id, scope.automation_ids),
      ),
    );

  for (const row of rows) {
    const week = weeks.get(row.automation_id ?? '');
    if (!week) continue;
    const fire = read_automation_fire(row);
    week.fires += 1;
    if (fire.outcome === 'fired') week.ran += 1;
    if (fire.outcome === 'skipped') {
      const stage = fire.skipped?.stage ?? 'unknown';
      week.skipped_by_stage[stage] = (week.skipped_by_stage[stage] ?? 0) + 1;
    }
  }
}

const notification_outcome_event_types: string[] = [
  'notify_now',
  'add_to_daily_summary',
  'add_to_ideas_list',
  'drop_with_reason',
].map((outcome) => notification_event_type(outcome as NotificationOutcome));

async function count_notifications(db: Database, scope: Scope, weeks: WeekByAutomation) {
  const outcomes = await db
    .select({
      event_id: events.event_id,
      event_type: events.event_type,
      automation_id: sql<string | null>`${events.event_body} ->> 'automation_id'`,
    })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, scope.workspace_id),
        eq(events.source, notification_source),
        inArray(events.event_type, notification_outcome_event_types),
        gte(events.created_time, scope.since),
        inArray(sql`${events.event_body} ->> 'automation_id'`, scope.automation_ids),
      ),
    );
  if (outcomes.length === 0) return;
  // The endings are looked up in a second pass and joined in memory — one workspace's
  // week is a few hundred notifications. Upgrade path is a left join when that stops being true.
  const endings = await read_notification_endings(
    db,
    scope.workspace_id,
    outcomes.map((row) => row.event_id),
  );

  for (const row of outcomes) {
    const week = weeks.get(row.automation_id ?? '');
    if (!week) continue;
    week.notifications += 1;
    const end = read_notification_end(row.event_type, endings.get(row.event_id) ?? null);
    if (end) week.notifications_by_end[end] += 1;
  }
}

async function read_notification_endings(
  db: Database,
  workspace_id: string,
  outcome_event_ids: string[],
) {
  const rows = await db
    .select({
      event_type: events.event_type,
      outcome_event_id: sql<string>`${events.event_body} ->> 'outcome_event_id'`,
    })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, workspace_id),
        eq(events.source, notification_source),
        inArray(sql`${events.event_body} ->> 'outcome_event_id'`, outcome_event_ids),
      ),
    );
  return new Map(rows.map((row) => [row.outcome_event_id, row.event_type]));
}

function read_notification_end(outcome_type: string, follow_up_type: string | null) {
  if (outcome_type === notification_event_type('drop_with_reason')) return null;
  if (follow_up_type === notification_follow_up_event_type('acted')) return 'acted' as const;
  if (follow_up_type === notification_follow_up_event_type('dismissed')) {
    return 'dismissed' as const;
  }
  return 'open' as const;
}

async function count_answered_approvals(db: Database, scope: Scope, weeks: WeekByAutomation) {
  const rows = await db
    .select({
      automation_id: runs.automation_id,
      decision: sql<string | null>`${events.event_body} ->> 'decision'`,
    })
    .from(event_jobs)
    .innerJoin(
      runs,
      and(
        eq(runs.workspace_id, event_jobs.workspace_id),
        sql`${runs.run_id} = ${event_jobs.metadata} -> 'policy_approval' ->> 'source_run_id'`,
      ),
    )
    .leftJoin(
      events,
      and(
        eq(events.workspace_id, event_jobs.workspace_id),
        eq(events.event_type, policy_decision_event_type),
        sql`${events.event_body} ->> 'job_id' = ${event_jobs.job_id}`,
      ),
    )
    .where(
      and(
        eq(event_jobs.workspace_id, scope.workspace_id),
        eq(event_jobs.job_handler, policy_decision_job_handler),
        gte(event_jobs.created_time, scope.since),
        inArray(runs.automation_id, scope.automation_ids),
      ),
    );

  for (const row of rows) {
    const week = weeks.get(row.automation_id ?? '');
    if (!week) continue;
    if (row.decision === 'approved') week.approvals_answered_yes += 1;
    if (row.decision === 'denied') week.approvals_answered_no += 1;
  }
}
