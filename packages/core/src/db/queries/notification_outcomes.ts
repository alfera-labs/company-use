import type { Database } from '@coworker/core/db/connection';
import { type EnqueueEventInput, enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { plain_outcome_reason } from '@coworker/core/db/queries/notification_reason_words';
import { events } from '@coworker/core/db/schema';
import {
  type DeliveryChannel,
  type NotificationFollowUp,
  type NotificationOutcome,
  notification_evidence_schema,
  notification_held_schema,
  notification_proposed_action_schema,
  notification_urgencies,
} from '@coworker/core/db/schema/automation_contracts';
import { and, count, desc, eq, gte, inArray, lte, max, or, sql } from 'drizzle-orm';
import { z } from 'zod';

export const notification_source = 'notification';

const event_type_prefix = 'notification.';

export function notification_event_type(outcome: NotificationOutcome) {
  return `${event_type_prefix}${outcome}` as const;
}

export function notification_follow_up_event_type(follow_up: NotificationFollowUp) {
  return `${event_type_prefix}${follow_up}` as const;
}

const notification_event_body_schema = z.object({
  agent_id: z.string(),
  automation_id: z.string().nullable().default(null),
  run_id: z.string(),
  session_id: z.string().nullable().default(null),
  principal_id: z.string().nullable().default(null),
  title: z.string(),
  body: z.string(),
  urgency: z.enum(notification_urgencies),
  score: z.number(),
  outcome_reason: z.string(),
  held: notification_held_schema.default(null),
  policy_hash: z.string(),
  evidence: notification_evidence_schema,
  proposed_action: notification_proposed_action_schema.default({ kind: 'none' }),
  delivered_on: z.string().nullable().default(null),
  delivery_ref: z.string().nullable().default(null),
  delivery_error: z.string().nullable().default(null),
  expires_time: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

type NotificationEventBody = z.infer<typeof notification_event_body_schema>;

export type NotificationEventRow = typeof events.$inferSelect;

export type Notification = {
  event_id: string;
  workspace_id: string;
  event_type: string;
  outcome: NotificationOutcome;
  queue_key: string;
  fingerprint: string;
  created_time: Date;
  notification: NotificationEventBody;
};

function read_notification(row: NotificationEventRow): Notification {
  return {
    event_id: row.event_id,
    workspace_id: row.workspace_id,
    event_type: row.event_type,
    outcome: row.event_type.slice(event_type_prefix.length) as NotificationOutcome,
    queue_key: row.queue_key,
    fingerprint: row.source_event_id,
    created_time: row.created_time,
    notification: with_plain_reason(notification_event_body_schema.parse(row.event_body)),
  };
}

function with_plain_reason<T extends { outcome_reason: string }>(body: T): T {
  return { ...body, outcome_reason: plain_outcome_reason(body.outcome_reason) };
}

export type RecordNotificationOutcomeInput = {
  workspace_id: string;
  subject: string;
  fingerprint: string;
  outcome: NotificationOutcome;
  actor_id: string;
  notification: z.input<typeof notification_event_body_schema>;
};

export async function record_notification_outcome(
  db: Database,
  input: RecordNotificationOutcomeInput,
): Promise<Notification | null> {
  const result = await enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: notification_source,
    source_event_id: input.fingerprint,
    event_type: notification_event_type(input.outcome),
    queue_key: input.subject,
    actor_key: input.actor_id,
    event_body: input.notification,
    event_jobs: [],
  } satisfies EnqueueEventInput);
  return result.created ? read_notification(result.event) : null;
}

export async function append_notification_follow_up(
  db: Database,
  input: {
    workspace_id: string;
    fingerprint: string;
    subject: string;
    follow_up: NotificationFollowUp;
    outcome_event_id: string;
    actor_id: string;
  },
): Promise<NotificationEventRow | null> {
  const result = await enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: notification_source,
    source_event_id: `${input.fingerprint}:${input.follow_up}`,
    event_type: notification_follow_up_event_type(input.follow_up),
    queue_key: input.subject,
    actor_key: input.actor_id,
    event_body: { outcome_event_id: input.outcome_event_id },
    event_jobs: [],
  });
  return result.created ? result.event : null;
}

export async function count_notifications_sent_today(
  db: Database,
  input: {
    workspace_id: string;
    principal_id: string | null;
    timezone: string;
    automation_id?: string | null | undefined;
    up_to_event_id?: string | undefined;
  },
) {
  const start_of_day = sql`date_trunc('day', now() AT TIME ZONE ${input.timezone}) AT TIME ZONE ${input.timezone}`;
  const [row] = await db
    .select({ notification_count: count() })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.event_type, notification_event_type('notify_now')),
        sql`${events.event_body} ->> 'delivery_error' is null`,
        input.principal_id === null
          ? undefined
          : sql`${events.event_body} ->> 'principal_id' = ${input.principal_id}`,
        input.automation_id
          ? sql`${events.event_body} ->> 'automation_id' = ${input.automation_id}`
          : undefined,
        sql`${events.created_time} >= ${start_of_day}`,
        input.up_to_event_id ? lte(events.event_id, input.up_to_event_id) : undefined,
      ),
    );

  return row?.notification_count ?? 0;
}

export async function set_notification_delivery(
  db: Database,
  input: {
    workspace_id: string;
    event_id: string;
    actor_id: string;
    delivery: {
      delivered_on: DeliveryChannel | string | null;
      delivery_ref: string | null;
      delivery_error: string | null;
    };
    metadata?: Record<string, unknown> | undefined;
  },
) {
  const patch = {
    delivered_on: input.delivery.delivered_on,
    delivery_ref: input.delivery.delivery_ref,
    delivery_error: input.delivery.delivery_error,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
  await db
    .update(events)
    .set({
      event_body: sql`${events.event_body} || ${JSON.stringify(patch)}::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(events.workspace_id, input.workspace_id), eq(events.event_id, input.event_id)));
}

function has_no_follow_up() {
  return sql`not exists (
    select 1
    from "events" follow_ups
    where follow_ups."workspace_id" = ${events.workspace_id}
      and follow_ups."source" = ${notification_source}
      and follow_ups."event_body" ->> 'outcome_event_id' = ${events.event_id}
  )`;
}

function is_outcome_of(outcomes: NotificationOutcome[] | undefined) {
  return inArray(
    events.event_type,
    (outcomes ?? [...notification_outcome_list]).map(notification_event_type),
  );
}

const notification_outcome_list: NotificationOutcome[] = [
  'notify_now',
  'add_to_daily_summary',
  'add_to_ideas_list',
  'drop_with_reason',
];

export async function list_open_notifications(
  db: Database,
  input: {
    workspace_id: string;
    outcomes?: NotificationOutcome[] | undefined;
    since?: Date | undefined;
    limit?: number | undefined;
  },
): Promise<Notification[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, notification_source),
        is_outcome_of(input.outcomes),
        input.since ? gte(events.created_time, input.since) : undefined,
        has_no_follow_up(),
      ),
    )
    .orderBy(desc(events.created_time))
    .limit(input.limit ?? 100);
  return rows.map(read_notification);
}

export async function search_notifications(
  db: Database,
  input: { workspace_id: string; search_text: string; days: number; limit?: number | undefined },
): Promise<Notification[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, notification_source),
        is_outcome_of(undefined),
        sql`${events.created_time} >= now() - make_interval(days => ${input.days})`,
        matches_words(input.search_text),
      ),
    )
    .orderBy(desc(events.created_time))
    .limit(input.limit ?? 50);
  return rows.map(read_notification);
}

function escape_like(text: string) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function matches_words(search_text: string) {
  const pattern = `%${escape_like(search_text)}%`;
  return or(
    sql`${events.event_body} ->> 'title' ILIKE ${pattern}`,
    sql`${events.event_body} ->> 'body' ILIKE ${pattern}`,
    sql`(${events.event_body} -> 'evidence')::text ILIKE ${pattern}`,
  );
}

export type NotificationPageItem = Notification & { is_open: boolean };

export async function list_notifications_page(
  db: Database,
  input: {
    workspace_id: string;
    automation_id?: string | undefined;
    outcomes?: NotificationOutcome[] | undefined;
    only_open?: boolean | undefined;
    days?: number | undefined;
    search_text?: string | undefined;
    page: number;
    page_size: number;
  },
) {
  const where = and(
    eq(events.workspace_id, input.workspace_id),
    eq(events.source, notification_source),
    is_outcome_of(input.outcomes),
    input.automation_id
      ? sql`${events.event_body} ->> 'automation_id' = ${input.automation_id}`
      : undefined,
    input.only_open ? has_no_follow_up() : undefined,
    input.days === undefined
      ? undefined
      : sql`${events.created_time} >= now() - make_interval(days => ${input.days})`,
    input.search_text === undefined ? undefined : matches_words(input.search_text),
  );
  const [total_row, rows] = await Promise.all([
    db.select({ total_count: count() }).from(events).where(where),
    db
      .select({ event: events, is_open: sql<boolean>`${has_no_follow_up()}` })
      .from(events)
      .where(where)
      .orderBy(desc(events.created_time))
      .limit(input.page_size)
      .offset((input.page - 1) * input.page_size),
  ]);
  return {
    items: rows.map((row) => ({ ...read_notification(row.event), is_open: row.is_open })),
    total_count: total_row[0]?.total_count ?? 0,
    page: input.page,
    page_size: input.page_size,
  };
}

export async function find_last_summary_time(db: Database, workspace_id: string) {
  const [row] = await db
    .select({ last_summary_time: max(events.created_time) })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, workspace_id),
        eq(events.source, notification_source),
        eq(events.event_type, notification_follow_up_event_type('summarized')),
      ),
    );

  return row?.last_summary_time ?? null;
}

export async function list_dismissed_notification_fingerprints(
  db: Database,
  input: { workspace_id: string; since: Date },
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ source_event_id: events.source_event_id })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, notification_source),
        eq(events.event_type, notification_follow_up_event_type('dismissed')),
        gte(events.created_time, input.since),
      ),
    );

  return new Set(rows.map((row) => row.source_event_id.split(':')[0] ?? row.source_event_id));
}

export async function find_notification(
  db: Database,
  input: { workspace_id: string; event_id: string },
): Promise<Notification | null> {
  const [row] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, notification_source),
        eq(events.event_id, input.event_id),
        is_outcome_of(undefined),
      ),
    )
    .limit(1);
  return row ? read_notification(row) : null;
}

export async function run_wrote_a_notification(
  db: Database,
  input: { workspace_id: string; run_id: string },
) {
  const [said_something] = await db
    .select({ event_id: events.event_id })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, notification_source),
        sql`${events.event_body} ->> 'run_id' = ${input.run_id}`,
      ),
    )
    .limit(1);
  return Boolean(said_something);
}

export async function list_notifications_by_run_ids(
  db: Database,
  input: { workspace_id: string; run_ids: string[] },
): Promise<NotificationPageItem[]> {
  if (input.run_ids.length === 0) return [];
  const run_id = sql`${events.event_body} ->> 'run_id'`;
  const rows = await db
    .selectDistinctOn([run_id], { event: events, is_open: sql<boolean>`${has_no_follow_up()}` })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, input.workspace_id),
        eq(events.source, notification_source),
        is_outcome_of(undefined),
        inArray(run_id, input.run_ids),
      ),
    )
    .orderBy(run_id, desc(events.created_time), desc(events.event_id));
  return rows.map((row) => ({ ...read_notification(row.event), is_open: row.is_open }));
}
