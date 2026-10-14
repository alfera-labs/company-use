import { env } from '@coworker/config';
import { plans } from '@coworker/config/plans';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import {
  build_event_job_values,
  build_event_values,
  event_actor_id,
  event_status_for_jobs,
} from '@coworker/core/db/queries/event_enqueue_statement';
import { event_jobs, events } from '@coworker/core/db/schema';
import type {
  EventJobMetadataData,
  EventRawPayloadData,
} from '@coworker/core/db/schema/json_column_types';
import { job_handlers_that_count_toward_the_workspace_run_limit } from '@coworker/shared';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';

export { enqueue_event_jobs } from '@coworker/core/db/queries/event_enqueue_statement';

export type EventStatus = 'accepted' | 'routed' | 'delivered' | 'ignored' | 'invalid';

export type QueueEventJobInput = {
  job_handler: string;
  available_time?: Date;
  metadata?: EventJobMetadataData;
};

export type EnqueueEventInput = {
  event_id?: string;
  workspace_id: string;
  source: string;
  source_event_id: string;
  event_type: string;
  queue_key: string;
  actor_key: string;
  event_body?: Record<string, unknown>;
  raw_payload?: EventRawPayloadData;
  event_status?: EventStatus;
  metadata?: Record<string, unknown>;
  event_jobs?: QueueEventJobInput[];
};

export async function enqueue_event_jobs_in_transaction(
  db: DatabaseExecutor,
  input: EnqueueEventInput,
) {
  const event_result = await record_event(db, {
    ...input,
    event_status: input.event_status ?? event_status_for_jobs(input.event_jobs ?? []),
  });
  if (!event_result.created) return { ...event_result, event_jobs: [] };

  const woken_jobs = await wake_waiting_event_jobs(db, event_result.event);

  const queued_jobs = await queue_event_jobs(db, {
    workspace_id: input.workspace_id,
    event_id: event_result.event.event_id,
    queue_key: input.queue_key,
    event_jobs: input.event_jobs ?? [],
  });
  const routed_event =
    woken_jobs.length > 0 ? await mark_event_routed(db, event_result.event) : event_result.event;
  return { ...event_result, event: routed_event, event_jobs: [...woken_jobs, ...queued_jobs] };
}

export async function find_event_with_jobs(
  db: Database,
  input: { workspace_id: string; event_id: string },
) {
  const event = await db.query.events.findFirst({
    where: and(eq(events.workspace_id, input.workspace_id), eq(events.event_id, input.event_id)),
  });
  if (!event) return null;

  const jobs = await db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.workspace_id, input.workspace_id),
      eq(event_jobs.event_id, input.event_id),
    ),
    orderBy: (table) => [asc(table.created_time)],
  });
  return { event, event_jobs: jobs };
}

export async function mark_event_delivered(
  db: Database,
  input: {
    workspace_id: string;
    event_id: string;
    delivery_data: Record<string, unknown>;
  },
) {
  const [event] = await db
    .update(events)
    .set({
      event_status: 'delivered',
      metadata: sql`${events.metadata} || ${JSON.stringify({ delivery: input.delivery_data })}::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: event_actor_id,
    })
    .where(and(eq(events.workspace_id, input.workspace_id), eq(events.event_id, input.event_id)))
    .returning();
  return event ?? null;
}

async function record_event(
  db: DatabaseExecutor,
  input: EnqueueEventInput & { event_status: EventStatus },
) {
  const [inserted_event] = await db
    .insert(events)
    .values(build_event_values(input))
    .onConflictDoNothing({
      target: [events.workspace_id, events.source, events.source_event_id],
    })
    .returning();

  if (inserted_event) return { event: inserted_event, created: true };
  return { event: await find_existing_event(db, input), created: false };
}

async function wake_waiting_event_jobs(db: DatabaseExecutor, event: typeof events.$inferSelect) {
  return db
    .update(event_jobs)
    .set({
      event_id: sql`coalesce(${event_jobs.event_id}, ${event.event_id})`,
      job_status: 'queued',
      available_time: new Date(),
      last_updated_time: new Date(),
      last_updated_by: event_actor_id,
    })
    .where(
      and(
        eq(event_jobs.workspace_id, event.workspace_id),
        eq(event_jobs.job_status, 'waiting'),
        eq(event_jobs.awaits_event_type, event.event_type),
        eq(event_jobs.awaits_queue_key, event.queue_key),
      ),
    )
    .returning();
}

async function mark_event_routed(db: DatabaseExecutor, event: typeof events.$inferSelect) {
  if (event.event_status === 'routed') return event;
  const [routed] = await db
    .update(events)
    .set({
      event_status: 'routed',
      last_updated_time: new Date(),
      last_updated_by: event_actor_id,
    })
    .where(eq(events.event_id, event.event_id))
    .returning();
  return routed ?? event;
}

async function queue_event_jobs(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    event_id: string;
    queue_key: string;
    event_jobs: QueueEventJobInput[];
  },
) {
  if (input.event_jobs.length === 0) return [];

  return db
    .insert(event_jobs)
    .values(input.event_jobs.map((job) => build_event_job_values(input, job)))
    .returning();
}

export async function find_event_by_source_id(
  db: DatabaseExecutor,
  input: { workspace_id: string; source: string; source_event_id: string },
) {
  const event = await db.query.events.findFirst({
    where: and(
      eq(events.workspace_id, input.workspace_id),
      eq(events.source, input.source),
      eq(events.source_event_id, input.source_event_id),
    ),
  });
  return event ?? null;
}

async function find_existing_event(db: DatabaseExecutor, input: EnqueueEventInput) {
  const event = await find_event_by_source_id(db, input);
  if (!event) throw new Error('Event insert was skipped but existing row was not found');
  return event;
}

export function workspace_has_room_for_another_run_condition(now: Date) {
  const now_sql = sql`${now.toISOString()}::timestamptz`;
  const handlers_sql = counted_run_job_handlers_sql();

  return sql`not exists (
    select 1
    from "event_jobs" next_ready_jobs
    where ${ready_run_starting_job_sql(now_sql, handlers_sql)}
      and ${running_run_count_sql(now_sql, handlers_sql)} >= ${workspace_run_limit_sql()}
  )`;
}

function ready_run_starting_job_sql(now_sql: SQL, handlers_sql: SQL) {
  return sql`next_ready_jobs."workspace_id" = ${event_jobs.workspace_id}
      and next_ready_jobs."subject_key" = ${event_jobs.queue_key}
      and next_ready_jobs."job_status" = 'queued'
      and next_ready_jobs."available_time" <= ${now_sql}
      and next_ready_jobs."job_handler" in ${handlers_sql}`;
}

function running_run_count_sql(now_sql: SQL, handlers_sql: SQL) {
  return sql`(
        select count(distinct running_jobs."subject_key")::int
        from "event_jobs" running_jobs
        where running_jobs."workspace_id" = ${event_jobs.workspace_id}
          and running_jobs."job_status" = 'running'
          and running_jobs."job_handler" in ${handlers_sql}
          and running_jobs."locked_until" > ${now_sql}
      )`;
}

function workspace_run_limit_sql() {
  const metadata_limit = workspace_metadata_run_limit_sql();
  const plan_limit = workspace_plan_run_limit_sql();
  return sql`coalesce(
      least(${metadata_limit}, ${plan_limit}),
      ${metadata_limit},
      ${plan_limit},
      ${env.WORKSPACE_MAX_CONCURRENT_RUNS}
    )`;
}

function workspace_metadata_run_limit_sql() {
  return sql`(
          select case
            when jsonb_typeof(run_limits.limit_value) = 'number' then
              case
                when run_limits.limit_value::numeric between 1 and 2147483647
                  and run_limits.limit_value::numeric = trunc(run_limits.limit_value::numeric)
                  then run_limits.limit_value::numeric::int
              end
          end
          from (
            select run_limit_workspaces."metadata"->'max_concurrent_runs' as limit_value
            from "workspaces" run_limit_workspaces
            where run_limit_workspaces."workspace_id" = ${event_jobs.workspace_id}
          ) run_limits
        )`;
}

function workspace_plan_run_limit_sql() {
  return sql`(
    select case plan_limit_plans."plan_slug"
      when ${plans.starter_v2.catalog_slug} then ${plans.starter_v2.concurrent_run_limit}::int
      when ${plans.pro_v2.catalog_slug} then ${plans.pro_v2.concurrent_run_limit}::int
      when ${plans.pro.catalog_slug} then ${plans.pro.concurrent_run_limit}::int
      when ${plans.business.catalog_slug} then ${plans.business.concurrent_run_limit}::int
    end
    from "subscriptions" plan_limit_subscriptions
    join "billing_plans" plan_limit_plans
      on plan_limit_plans."billing_plan_id" = plan_limit_subscriptions."billing_plan_id"
    where plan_limit_subscriptions."workspace_id" = ${event_jobs.workspace_id}
      and plan_limit_subscriptions."subscription_status" in ('active', 'trialing', 'past_due')
    order by plan_limit_subscriptions."created_time" desc
    limit 1
  )`;
}

function counted_run_job_handlers_sql() {
  return sql`(${sql.join(
    job_handlers_that_count_toward_the_workspace_run_limit.map((handler) => sql`${handler}`),
    sql`, `,
  )})`;
}
