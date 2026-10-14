import { createHash } from 'node:crypto';
import { read_approval_calls } from '@coworker/core/access/tool_policy_approval_schema';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { choices_answer_event_type } from '@coworker/core/db/queries/choices_answers';
import { enqueue_event_jobs_in_transaction } from '@coworker/core/db/queries/events';
import { event_jobs, tool_calls } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import type {
  ChoicesWaitData,
  ToolPolicyApprovalWaitData,
} from '@coworker/core/db/schema/json_column_types';
import { create_id, id_prefixes, session_queue_key } from '@coworker/shared';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

type EventJob = typeof event_jobs.$inferSelect;

const event_actor_id = 'system:events';
export const policy_decision_event_type = 'person.decided';
export const policy_decision_job_handler = 'policy_decision_resume';

export function hash_tool_input_for_approval(tool_input: unknown): string {
  return createHash('sha256').update(canonical_json(tool_input)).digest('hex');
}

export function tool_policy_wait_subject(input: {
  run_id: string;
  approval_call_hashes: readonly string[];
}) {
  const digest = createHash('sha256')
    .update([input.run_id, ...[...input.approval_call_hashes].sort()].join(':'))
    .digest('hex');
  return `wait:tool_policy:${digest}`;
}

const tool_policy_wait_expiry_ms = 72 * 60 * 60 * 1000;

export function new_approval_request_id() {
  return create_id(id_prefixes.event_job);
}

export async function create_tool_policy_wait(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    wait: ToolPolicyApprovalWaitData;
    job_id?: string;
    actor_id: string;
  },
) {
  return db.transaction(async (tx) => create_tool_policy_wait_in_transaction(tx, input));
}

async function create_tool_policy_wait_in_transaction(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    queue_key: string;
    wait: ToolPolicyApprovalWaitData;
    job_id?: string;
    actor_id: string;
  },
) {
  const [created] = await db
    .insert(event_jobs)
    .values({
      job_id: input.job_id ?? create_id(id_prefixes.event_job),
      workspace_id: input.workspace_id,
      event_id: null,
      queue_key: session_queue_key(input.wait.session_id),
      job_handler: policy_decision_job_handler,
      job_status: 'waiting',
      awaits_event_type: policy_decision_event_type,
      awaits_queue_key: input.queue_key,
      awaits_until_time: new Date(Date.now() + tool_policy_wait_expiry_ms),
      metadata: { policy_approval: input.wait },
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await enqueue_event_jobs_in_transaction(db, {
      workspace_id: input.workspace_id,
      source: 'policy',
      source_event_id: `${created.job_id}:requested`,
      event_type: 'policy.approval_requested',
      queue_key: input.queue_key,
      actor_key: input.actor_id,
      event_body: { job_id: created.job_id, call_count: read_approval_calls(input.wait).length },
    });
    return { event_job: created, created: true };
  }

  const existing = await find_waiting_job(db, input.workspace_id, input.queue_key);
  if (!existing) throw new Error('Policy wait insert conflicted but no waiting row was found.');
  return { event_job: existing, created: false };
}

export function choices_wait_subject(input: { run_id: string }) {
  return `wait:choices:${input.run_id}`;
}

export async function create_choices_wait(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    wait: ChoicesWaitData;
    actor_id: string;
  },
) {
  const [created] = await db
    .insert(event_jobs)
    .values({
      job_id: create_id(id_prefixes.event_job),
      workspace_id: input.workspace_id,
      event_id: null,
      queue_key: session_queue_key(input.wait.session_id),
      job_handler: policy_decision_job_handler,
      job_status: 'waiting',
      awaits_event_type: choices_answer_event_type,
      awaits_queue_key: input.queue_key,
      awaits_until_time: new Date(Date.now() + tool_policy_wait_expiry_ms),
      metadata: { choices_wait: input.wait },
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return { event_job: created, created: true };

  const existing = await find_waiting_job(
    db,
    input.workspace_id,
    input.queue_key,
    choices_answer_event_type,
  );
  if (!existing) throw new Error('Choices wait insert conflicted but no waiting row was found.');
  return { event_job: existing, created: false };
}

export async function record_choices_answer_taken_by_the_run(
  db: Database,
  input: { workspace_id: string; job_id: string; actor_id: string },
) {
  const [taken] = await db
    .update(event_jobs)
    .set({
      metadata: sql`${event_jobs.metadata} || '{"answer_taken_by_the_run_that_asked":true}'::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(event_jobs.workspace_id, input.workspace_id), eq(event_jobs.job_id, input.job_id)),
    )
    .returning();
  return taken ?? null;
}

export function withdraw_run_tool_policy_waits(
  db: Database,
  input: { workspace_id: string; run_id: string; actor_id: string },
) {
  return withdraw_tool_policy_waits(db, {
    workspace_id: input.workspace_id,
    withdrawn: 'run_cancelled',
    match: sql`COALESCE(
      ${event_jobs.metadata} -> 'policy_approval' ->> 'source_run_id',
      ${event_jobs.metadata} -> 'choices_wait' ->> 'source_run_id'
    ) = ${input.run_id}`,
    actor_id: input.actor_id,
  });
}

export async function withdraw_superseded_tool_policy_waits(
  db: Database,
  input: { workspace_id: string; wait: EventJob; actor_id: string },
) {
  const asking_again = read_wait_data(input.wait);
  if (!asking_again) return 0;

  const asked_before = await db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.workspace_id, input.workspace_id),
      eq(event_jobs.job_handler, policy_decision_job_handler),
      eq(event_jobs.job_status, 'waiting'),
      sql`${event_jobs.metadata} -> 'policy_approval' ->> 'session_id' = ${asking_again.session_id}`,
      sql`${event_jobs.metadata} -> 'policy_approval' ->> 'source_run_id' <> ${asking_again.source_run_id}`,
    ),
  });
  const same_step = await read_step_fingerprint(db, input.workspace_id, input.wait);
  const superseded: string[] = [];
  for (const older of asked_before) {
    if ((await read_step_fingerprint(db, input.workspace_id, older)) === same_step) {
      superseded.push(older.job_id);
    }
  }
  if (superseded.length === 0) return 0;

  return withdraw_tool_policy_waits(db, {
    workspace_id: input.workspace_id,
    withdrawn: 'superseded',
    match: inArray(event_jobs.job_id, superseded),
    actor_id: input.actor_id,
  });
}

async function withdraw_tool_policy_waits(
  db: Database,
  input: {
    workspace_id: string;
    withdrawn: 'run_cancelled' | 'superseded';
    match: SQL;
    actor_id: string;
  },
) {
  const withdrawn = await db
    .update(event_jobs)
    .set({
      job_status: 'done',
      result_data: { withdrawn: input.withdrawn },
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.job_handler, policy_decision_job_handler),
        eq(event_jobs.job_status, 'waiting'),
        input.match,
      ),
    )
    .returning();

  const held_call_ids = withdrawn.flatMap((wait) =>
    read_wait_calls(wait).map((call) => call.tool_call_id),
  );
  if (held_call_ids.length > 0) {
    await db
      .update(tool_calls)
      .set({ tool_status: 'cancelled', ...updated_by(input.actor_id) })
      .where(
        and(
          eq(tool_calls.workspace_id, input.workspace_id),
          inArray(tool_calls.tool_call_id, held_call_ids),
          eq(tool_calls.tool_status, 'awaiting_approval'),
        ),
      );
  }
  return withdrawn.length;
}

async function read_step_fingerprint(db: Database, workspace_id: string, wait: EventJob) {
  const calls = read_wait_calls(wait);
  if (calls.length === 0) return '';
  const held = await db.query.tool_calls.findMany({
    where: and(
      eq(tool_calls.workspace_id, workspace_id),
      inArray(
        tool_calls.tool_call_id,
        calls.map((call) => call.tool_call_id),
      ),
    ),
    columns: { tool_call_id: true, tool_name: true },
  });
  const tool_name_by_call_id = new Map(held.map((row) => [row.tool_call_id, row.tool_name]));
  return calls
    .map((call) => `${tool_name_by_call_id.get(call.tool_call_id) ?? ''}:${call.input_sha256}`)
    .sort()
    .join('|');
}

function read_wait_calls(wait: EventJob) {
  const data = read_wait_data(wait);
  return data ? read_approval_calls(data) : [];
}

function read_wait_data(wait: EventJob) {
  return (
    (wait.metadata as { policy_approval?: ToolPolicyApprovalWaitData }).policy_approval ?? null
  );
}

export async function list_tool_policy_waits(
  db: Database,
  input: {
    workspace_id: string;
    status?: 'waiting' | 'queued' | 'running' | 'done';
    limit?: number;
  },
) {
  return db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.workspace_id, input.workspace_id),
      ...(input.status ? [eq(event_jobs.job_status, input.status)] : []),
      eq(event_jobs.job_handler, policy_decision_job_handler),
    ),
    orderBy: [desc(event_jobs.created_time)],
    limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
  });
}

export async function list_session_tool_policy_waits(
  db: Database,
  input: { workspace_id: string; session_id: string; status?: 'waiting' | 'queued' | 'done' },
) {
  return db.query.event_jobs.findMany({
    where: and(
      eq(event_jobs.workspace_id, input.workspace_id),
      eq(event_jobs.job_handler, policy_decision_job_handler),
      ...(input.status ? [eq(event_jobs.job_status, input.status)] : []),
      sql`${event_jobs.metadata} -> 'policy_approval' ->> 'session_id' = ${input.session_id}`,
    ),
  });
}

export async function list_sessions_waiting_on_approval(
  db: Database,
  input: { workspace_id: string; session_ids: string[] },
): Promise<Set<string>> {
  if (input.session_ids.length === 0) return new Set();
  const rows = await db
    .selectDistinct({
      session_id: sql<string>`${event_jobs.metadata} -> 'policy_approval' ->> 'session_id'`,
    })
    .from(event_jobs)
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.job_handler, policy_decision_job_handler),
        eq(event_jobs.job_status, 'waiting'),
        inArray(
          sql`${event_jobs.metadata} -> 'policy_approval' ->> 'session_id'`,
          input.session_ids,
        ),
      ),
    );
  return new Set(rows.map((row) => row.session_id).filter((id): id is string => Boolean(id)));
}

export async function get_tool_policy_wait(
  db: Database,
  input: { workspace_id: string; job_id: string },
) {
  return (
    (await db.query.event_jobs.findFirst({
      where: and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.job_id, input.job_id),
        eq(event_jobs.job_handler, policy_decision_job_handler),
      ),
    })) ?? null
  );
}

// Spends one approval, for one held call, once. A step that held three calls spends three
// approvals off the same decision, and a replay of any of them finds its own already spent.
//
// The whole check is the WHERE clause, so two deliveries racing cannot both win: the second
// update matches no row because the first already appended this call to the spent list.
export async function consume_tool_policy_approval(
  db: Database,
  input: { workspace_id: string; job_id: string; tool_call_id: string },
) {
  const [consumed] = await db
    .update(event_jobs)
    .set({
      result_data: sql`jsonb_set(
        ${event_jobs.result_data},
        '{approval_consumed_tool_call_ids}',
        coalesce(${event_jobs.result_data} -> 'approval_consumed_tool_call_ids', '[]'::jsonb)
          || to_jsonb(${input.tool_call_id}::text),
        true
      )`,
      last_updated_time: new Date(),
      last_updated_by: event_actor_id,
    })
    .where(
      and(
        eq(event_jobs.workspace_id, input.workspace_id),
        eq(event_jobs.job_id, input.job_id),
        sql`NOT (
          coalesce(${event_jobs.result_data} -> 'approval_consumed_tool_call_ids', '[]'::jsonb)
            @> to_jsonb(${input.tool_call_id}::text)
        )`,
      ),
    )
    .returning();
  return consumed ?? null;
}

function find_waiting_job(
  db: DatabaseExecutor,
  workspace_id: string,
  queue_key: string,
  awaits_event_type: string = policy_decision_event_type,
) {
  return db.query.event_jobs.findFirst({
    where: and(
      eq(event_jobs.workspace_id, workspace_id),
      eq(event_jobs.job_status, 'waiting'),
      eq(event_jobs.awaits_event_type, awaits_event_type),
      eq(event_jobs.awaits_queue_key, queue_key),
    ),
  });
}

function canonical_json(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_json).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical_json(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
