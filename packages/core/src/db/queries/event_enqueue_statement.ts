import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import type {
  EnqueueEventInput,
  EventStatus,
  QueueEventJobInput,
} from '@coworker/core/db/queries/events';
import { read_execute_rows } from '@coworker/core/db/queries/read_execute_rows';
import { read_table_row_from_json } from '@coworker/core/db/queries/table_row_from_json';
import { event_jobs, events } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

export const event_actor_id = 'system:events';

type EnqueuedRow = {
  row_kind: 'event' | 'woken_job' | 'queued_job';
  row_data: Record<string, unknown>;
};

export async function enqueue_event_jobs(db: Database, input: EnqueueEventInput) {
  const event = build_event_values({
    ...input,
    event_status: input.event_status ?? event_status_for_jobs(input.event_jobs ?? []),
  });
  const jobs = (input.event_jobs ?? []).map((job) => build_event_job_values(event, job));
  const rows = read_execute_rows<EnqueuedRow>(
    await db.execute(insert_event_and_jobs_statement(event, jobs)),
  );
  const inserted_event = rows.find((row) => row.row_kind === 'event');
  if (!inserted_event) {
    return { event: await find_existing_event(db, event), created: false, event_jobs: [] };
  }
  return {
    event: read_table_row_from_json(events, inserted_event.row_data),
    created: true,
    event_jobs: [...read_job_rows(rows, 'woken_job'), ...read_job_rows(rows, 'queued_job')],
  };
}

function insert_event_and_jobs_statement(
  event: typeof events.$inferInsert & { event_id: string },
  jobs: Array<typeof event_jobs.$inferInsert>,
) {
  const now = new Date().toISOString();
  return sql`
    WITH inserted_event AS (
      INSERT INTO events (event_id, workspace_id, source, source_event_id, event_type, subject_key,
        actor_key, event_body, raw_payload, event_status, metadata, created_by, last_updated_by)
      VALUES (${event.event_id}, ${event.workspace_id}, ${event.source}, ${event.source_event_id},
        ${event.event_type}, ${event.queue_key}, ${event.actor_key},
        ${JSON.stringify(event.event_body)}::jsonb, ${JSON.stringify(event.raw_payload)}::jsonb,
        CASE WHEN ${waiting_jobs_for_event_exist(event)} THEN 'routed' ELSE ${event.event_status} END,
        ${JSON.stringify(event.metadata)}::jsonb, ${event_actor_id}, ${event_actor_id})
      ON CONFLICT (workspace_id, source, source_event_id) DO NOTHING
      RETURNING *
    ), woken_jobs AS (
      UPDATE event_jobs
      SET event_id = coalesce(event_jobs.event_id, inserted_event.event_id), job_status = 'queued',
        available_time = ${now}::timestamptz, last_updated_time = ${now}::timestamptz,
        last_updated_by = ${event_actor_id}
      FROM inserted_event
      WHERE event_jobs.workspace_id = inserted_event.workspace_id
        AND event_jobs.job_status = 'waiting'
        AND event_jobs.awaits_event_type = inserted_event.event_type
        AND event_jobs.awaits_subject_key = inserted_event.subject_key
      RETURNING event_jobs.*
    ), queued_jobs AS (
      INSERT INTO event_jobs (job_id, workspace_id, event_id, subject_key, job_handler,
        available_time, metadata, created_by, last_updated_by)
      SELECT job_id, workspace_id, event_id, subject_key, job_handler, available_time, metadata,
        created_by, last_updated_by
      FROM jsonb_to_recordset(${JSON.stringify(jobs.map(job_record))}::jsonb) AS job_values(
        job_id text, workspace_id text, event_id text, subject_key text, job_handler text,
        available_time timestamptz, metadata jsonb, created_by text, last_updated_by text)
      WHERE EXISTS (SELECT 1 FROM inserted_event)
      RETURNING *
    )
    SELECT 'event' AS row_kind, to_jsonb(inserted_event) AS row_data FROM inserted_event
    UNION ALL SELECT 'woken_job', to_jsonb(woken_jobs) FROM woken_jobs
    UNION ALL SELECT 'queued_job', to_jsonb(queued_jobs) FROM queued_jobs
  `;
}

function waiting_jobs_for_event_exist(event: typeof events.$inferInsert) {
  return sql`EXISTS (
    SELECT 1 FROM event_jobs
    WHERE workspace_id = ${event.workspace_id} AND job_status = 'waiting'
      AND awaits_event_type = ${event.event_type} AND awaits_subject_key = ${event.queue_key}
  )`;
}

function job_record(job: typeof event_jobs.$inferInsert) {
  return {
    job_id: job.job_id,
    workspace_id: job.workspace_id,
    event_id: job.event_id,
    subject_key: job.queue_key,
    job_handler: job.job_handler,
    available_time: (job.available_time ?? new Date()).toISOString(),
    metadata: job.metadata ?? {},
    created_by: job.created_by,
    last_updated_by: job.last_updated_by,
  };
}

function read_job_rows(rows: EnqueuedRow[], row_kind: EnqueuedRow['row_kind']) {
  return rows
    .filter((row) => row.row_kind === row_kind)
    .map((row) => read_table_row_from_json(event_jobs, row.row_data));
}

async function find_existing_event(
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
  if (!event) throw new Error('Event insert was skipped but existing row was not found');
  return event;
}

export function build_event_values(input: EnqueueEventInput & { event_status: EventStatus }) {
  return {
    event_id: input.event_id ?? create_id(id_prefixes.event),
    workspace_id: input.workspace_id,
    source: input.source,
    source_event_id: input.source_event_id,
    event_type: input.event_type,
    queue_key: input.queue_key,
    actor_key: input.actor_key,
    event_body: input.event_body ?? {},
    raw_payload: input.raw_payload ?? {},
    event_status: input.event_status,
    metadata: input.metadata ?? {},
    created_by: event_actor_id,
    last_updated_by: event_actor_id,
  } satisfies typeof events.$inferInsert;
}

export function build_event_job_values(
  input: { workspace_id: string; event_id: string; queue_key: string },
  job: QueueEventJobInput,
): typeof event_jobs.$inferInsert {
  return {
    job_id: create_id(id_prefixes.event_job),
    workspace_id: input.workspace_id,
    event_id: input.event_id,
    queue_key: input.queue_key,
    job_handler: job.job_handler,
    available_time: job.available_time ?? new Date(),
    metadata: job.metadata ?? {},
    created_by: event_actor_id,
    last_updated_by: event_actor_id,
  };
}

export function event_status_for_jobs(jobs: QueueEventJobInput[]): EventStatus {
  return jobs.length > 0 ? 'routed' : 'accepted';
}
