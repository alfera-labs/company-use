import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { find_database_error_details } from '@coworker/core/db/database_error';
import { find_session_for_external_thread } from '@coworker/core/db/queries/external_thread_session_lookup';
import { read_execute_rows } from '@coworker/core/db/queries/read_execute_rows';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import type {
  CreateSessionInput,
  RunMessageSource,
  SessionSource,
} from '@coworker/core/db/queries/session_input_types';
import {
  type ListedSessionsFilter,
  listed_sessions_filter,
} from '@coworker/core/db/queries/session_list';
import { cancel_all_waiting_session_messages } from '@coworker/core/db/queries/session_message_queue';
import { build_session_values } from '@coworker/core/db/queries/session_values';
import { visible_to_reader } from '@coworker/core/db/queries/session_visibility';
import type { UsageRecordKind } from '@coworker/core/db/queries/usage_record_kinds';
import {
  agents,
  connections,
  event_jobs,
  run_events,
  run_messages,
  run_model_context_snapshots,
  runs,
  runtime_environments,
  sandboxes,
  session_context_operations,
  sessions,
  tool_calls,
  usage_records,
  workspaces,
} from '@coworker/core/db/schema';
import { merge_metadata } from '@coworker/core/db/schema/common';
import type {
  RunMessageContentData,
  SessionMetadata,
  SessionTitleGeneration,
  ToolInputData,
  ToolResultPointerContentData,
} from '@coworker/core/db/schema/json_column_types';
import { write_after_earlier_writes } from '@coworker/core/db/write_after_earlier_writes';
import {
  type ChatStreamEventDraft,
  create_id,
  estimate_model_visible_message_tokens,
  id_prefixes,
  type MessageContent,
  merge_session_source_actor,
  NotFoundError,
  type SourceActor,
  strip_unstorable_characters,
} from '@coworker/shared';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

const stale_running_run_actor = 'system:run_recovery';
export const orphan_running_run_ms = 30 * 60 * 1000;
export const active_run_statuses = ['queued', 'starting', 'running', 'waiting'] as const;

export type { CreateSessionInput } from '@coworker/core/db/queries/session_input_types';

export async function create_session(db: Database, input: CreateSessionInput) {
  const [session] = await db.insert(sessions).values(build_session_values(input)).returning();
  return require_inserted_row(session, 'Session');
}

export async function find_last_user_activity_time(db: Database, workspace_id: string) {
  const [session] = await db
    .select({ time: sessions.last_updated_time })
    .from(sessions)
    .where(and(eq(sessions.workspace_id, workspace_id), ne(sessions.session_source, 'trigger')))
    .orderBy(desc(sessions.last_updated_time))
    .limit(1);
  const [workspace] = await db
    .select({ time: workspaces.created_time })
    .from(workspaces)
    .where(eq(workspaces.workspace_id, workspace_id))
    .limit(1);
  const times = [session?.time, workspace?.time].filter((time): time is Date => time != null);
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((time) => time.getTime())));
}

export async function find_or_create_session_for_external_thread(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    session_source: Exclude<SessionSource, 'dashboard'>;
    external_thread_key: string;
    session_title?: string | (() => string | Promise<string>);
    project_id?: string;
    source_metadata?: Record<string, unknown>;
    session_metadata?: SessionMetadata;
    actor_id: string;
  },
) {
  const existing_session = await find_session_for_external_thread(db, input);
  if (existing_session) return existing_session;

  const session_title =
    typeof input.session_title === 'function' ? await input.session_title() : input.session_title;

  try {
    return await create_session(db, {
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
      source_type: input.session_source,
      session_source: input.session_source,
      external_thread_key: input.external_thread_key,
      ...(input.project_id === undefined ? {} : { project_id: input.project_id }),
      ...(session_title === undefined ? {} : { session_title }),
      ...(input.source_metadata === undefined ? {} : { source_metadata: input.source_metadata }),
      ...(input.session_metadata === undefined ? {} : { session_metadata: input.session_metadata }),
      actor_id: input.actor_id,
    });
  } catch (error) {
    if (!is_external_thread_session_conflict(error)) throw error;
    const winning_session = await find_session_for_external_thread(db, input);
    if (winning_session) return winning_session;
    throw error;
  }
}

function is_external_thread_session_conflict(error: unknown) {
  const details = find_database_error_details(error);
  return (
    details?.code === '23505' &&
    (details.constraint_name === 'idx_sessions_external_thread_unique' ||
      details.constraint_name === undefined)
  );
}

export async function list_sessions(
  db: Database,
  workspace_id: string,
  filter: ListedSessionsFilter,
) {
  return db.query.sessions.findMany({
    where: listed_sessions_filter(workspace_id, filter),
    orderBy: [desc(sessions.last_updated_time)],
  });
}

export async function list_latest_session_runs(
  db: Database,
  input: { workspace_id: string; session_ids: string[] },
) {
  if (input.session_ids.length === 0) return [];

  return db
    .selectDistinctOn([runs.session_id], {
      session_id: runs.session_id,
      run_id: runs.run_id,
      run_status: runs.run_status,
      finished_time: runs.finished_time,
      created_time: runs.created_time,
    })
    .from(runs)
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        inArray(runs.session_id, input.session_ids),
        isNull(runs.parent_run_id),
      ),
    )
    .orderBy(asc(runs.session_id), desc(runs.created_time), desc(runs.run_id));
}

export async function archive_session(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
) {
  return db.transaction(async (tx) => {
    const archived = await archive_session_row(tx as Database, input);
    await cancel_all_waiting_session_messages(tx as Database, input);
    return archived;
  });
}

async function archive_session_row(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
) {
  const [session] = await db
    .update(sessions)
    .set({
      session_status: 'deleted',
      external_thread_key: null,
      active_run_id: null,
      locked_by_run_id: null,
      lock_expires_time: null,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    )
    .returning();

  return require_inserted_row(session, 'Session');
}

export async function get_session(db: Database, workspace_id: string, session_id: string) {
  return db.query.sessions.findFirst({
    where: and(eq(sessions.workspace_id, workspace_id), eq(sessions.session_id, session_id)),
  });
}

export async function get_session_for_user(
  db: Database,
  input: { workspace_id: string; session_id: string; user_id: string },
) {
  return db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_id, input.session_id),
      visible_to_reader(input.workspace_id, input.user_id),
    ),
  });
}

export async function replace_placeholder_session_title(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    title: string;
    title_generation: SessionTitleGeneration;
    actor_id: string;
  },
) {
  const [session] = await db
    .update(sessions)
    .set({
      session_title: input.title,
      session_metadata: sql`jsonb_set(
        ${sessions.session_metadata},
        '{title_generation}',
        ${JSON.stringify(input.title_generation)}::jsonb,
        true
      )`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.session_id, input.session_id),
        sql`${sessions.session_metadata} -> 'title_generation' ->> 'source' = 'placeholder'`,
      ),
    )
    .returning();

  return session ?? null;
}

export async function update_session_context_summary(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    session_id: string;
    context_summary: string | null;
    summarized_until_message_id: string | null;
    context_summary_metadata?: Record<string, unknown>;
    expected_summarized_until_message_id?: string | null;
    actor_id: string;
  },
) {
  const compares_before_setting = 'expected_summarized_until_message_id' in input;
  const [session] = await db
    .update(sessions)
    .set({
      context_summary: input.context_summary,
      summarized_until_message_id: input.summarized_until_message_id,
      session_metadata: input.context_summary_metadata
        ? sql`jsonb_set(
            ${sessions.session_metadata},
            '{context_summary}',
            ${JSON.stringify(input.context_summary_metadata)}::jsonb,
            true
          )`
        : undefined,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.session_id, input.session_id),
        ...(compares_before_setting
          ? [summarized_until_message_id_matches(input.expected_summarized_until_message_id)]
          : []),
      ),
    )
    .returning();

  if (compares_before_setting) return session ?? null;
  return require_inserted_row(session, 'Session');
}

function summarized_until_message_id_matches(message_id: string | null | undefined) {
  return message_id === null || message_id === undefined
    ? isNull(sessions.summarized_until_message_id)
    : eq(sessions.summarized_until_message_id, message_id);
}

export async function upsert_session_source_actor(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    source_actor: SourceActor;
    observed_time?: Date;
    actor_id: string;
    read_session?: typeof sessions.$inferSelect;
  },
) {
  const session =
    input.read_session ?? (await get_session(db, input.workspace_id, input.session_id));
  if (!session) throw new NotFoundError('Session');

  const merged_actors = merge_session_source_actor(
    session.session_metadata.actors ?? [],
    input.source_actor,
    input.observed_time,
  );

  const [updated_session] = await db
    .update(sessions)
    .set({
      session_metadata: sql`${sessions.session_metadata} || jsonb_build_object(
        'actors', ${JSON.stringify(merged_actors)}::jsonb
      )`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    )
    .returning();

  return require_inserted_row(updated_session, 'Session');
}

export async function create_session_context_operation(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    session_id: string;
    run_id?: string | null;
    operation_type: string;
    operation_sequence?: number;
    target_entry_ids?: string[];
    operation_data: unknown;
    operation_reason?: string | null;
    metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [operation] = await db
    .insert(session_context_operations)
    .values({
      session_context_operation_id: create_id(id_prefixes.session_context_operation),
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id ?? null,
      operation_type: input.operation_type,
      operation_sequence:
        input.operation_sequence ??
        (await get_next_session_context_operation_sequence(db, input.session_id)),
      target_entry_ids: input.target_entry_ids ?? [],
      operation_data: input.operation_data,
      operation_reason: input.operation_reason ?? null,
      metadata: input.metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(operation, 'Session context operation');
}

export async function list_session_context_operations(
  db: Database,
  input: { workspace_id: string; session_id: string; run_id?: string },
) {
  return db.query.session_context_operations.findMany({
    where: and(
      eq(session_context_operations.workspace_id, input.workspace_id),
      eq(session_context_operations.session_id, input.session_id),
      ...(input.run_id ? [eq(session_context_operations.run_id, input.run_id)] : []),
    ),
    orderBy: [
      asc(session_context_operations.operation_sequence),
      asc(session_context_operations.session_context_operation_id),
    ],
  });
}

async function get_next_session_context_operation_sequence(
  db: DatabaseExecutor,
  session_id: string,
) {
  const result = await db
    .select({
      next_sequence: sql<number>`COALESCE(MAX(${session_context_operations.operation_sequence}), 0) + 1`,
    })
    .from(session_context_operations)
    .where(eq(session_context_operations.session_id, session_id));

  return result[0]?.next_sequence ?? 1;
}

export async function acquire_session_execution_lock(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    actor_id: string;
    lease_ms?: number;
  },
) {
  const now = new Date();
  const lease_expires_time = new Date(now.getTime() + (input.lease_ms ?? 5 * 60 * 1000));
  const [session] = await db
    .update(sessions)
    .set({
      session_status: 'running',
      active_run_id: input.run_id,
      locked_by_run_id: input.run_id,
      lock_expires_time: lease_expires_time,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.session_id, input.session_id),
        ne(sessions.session_status, 'deleted'),
        or(
          isNull(sessions.locked_by_run_id),
          eq(sessions.locked_by_run_id, input.run_id),
          // A held lock with a NULL expiry matches neither of the other arms and
          // `lt(NULL, now)` is SQL NULL, so without the isNull arm such a session is
          // permanently unstealable — locked forever by a row nothing can reclaim.
          isNull(sessions.lock_expires_time),
          lt(sessions.lock_expires_time, now),
        ),
      ),
    )
    .returning();

  return session ?? null;
}

export async function release_session_execution_lock(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    actor_id: string;
    session_status?: 'active' | 'idle' | 'failed' | 'cancelled' | 'completed';
  },
) {
  const [session] = await db
    .update(sessions)
    .set({
      session_status: input.session_status ?? 'active',
      active_run_id: null,
      locked_by_run_id: null,
      lock_expires_time: null,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.session_id, input.session_id),
        eq(sessions.locked_by_run_id, input.run_id),
      ),
    )
    .returning();

  return session ?? null;
}

export async function renew_session_execution_lock(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    actor_id: string;
    lease_ms?: number;
  },
) {
  const now = new Date();
  const lease_expires_time = new Date(now.getTime() + (input.lease_ms ?? 5 * 60 * 1000));
  const [session] = await db
    .update(sessions)
    .set({
      session_status: 'running',
      active_run_id: input.run_id,
      lock_expires_time: lease_expires_time,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.session_id, input.session_id),
        eq(sessions.locked_by_run_id, input.run_id),
      ),
    )
    .returning();

  return session ?? null;
}

export async function recover_stale_running_runs(
  db: Database,
  input: {
    workspace_id?: string | undefined;
    now?: Date;
    actor_id?: string;
    orphan_stale_ms?: number;
    recover_orphan_runs?: boolean;
    limit?: number;
  } = {},
) {
  const now = input.now ?? new Date();
  const actor_id = input.actor_id ?? stale_running_run_actor;
  const limit = Math.max(input.limit ?? 50, 1);

  const stale_runs = await find_stale_running_runs(db, { ...input, now, limit });
  if (stale_runs.length === 0) return [];

  return db.transaction(async (tx) => {
    const recovered_runs = await tx
      .update(runs)
      .set({
        run_status: 'failed',
        completed_time: now,
        finished_time: now,
        error_message: strip_unstorable_characters(
          'Run was marked failed after its worker stopped.',
        ),
        last_updated_time: now,
        last_updated_by: actor_id,
      })
      .where(
        and(
          inArray(
            runs.run_id,
            stale_runs.map((run) => run.run_id),
          ),
          inArray(runs.run_status, active_run_statuses),
        ),
      )
      .returning();
    if (recovered_runs.length === 0) return [];

    const recovered_run_ids = recovered_runs.map((run) => run.run_id);
    await tx
      .update(run_messages)
      .set({
        is_model_visible: false,
        last_updated_time: now,
        last_updated_by: actor_id,
      })
      .where(
        and(
          inArray(run_messages.run_id, recovered_run_ids),
          eq(run_messages.message_role, 'assistant'),
        ),
      );

    await tx
      .update(sessions)
      .set({
        session_status: 'failed',
        active_run_id: null,
        locked_by_run_id: null,
        lock_expires_time: null,
        last_updated_time: now,
        last_updated_by: actor_id,
      })
      .where(inArray(sessions.locked_by_run_id, recovered_run_ids));

    return recovered_runs;
  });
}

async function find_stale_running_runs(
  db: DatabaseExecutor,
  input: {
    workspace_id?: string | undefined;
    now: Date;
    orphan_stale_ms?: number;
    recover_orphan_runs?: boolean;
    limit: number;
  },
) {
  const expired_lock_runs = await find_expired_lock_runs(db, input);
  if (expired_lock_runs.length >= input.limit) return expired_lock_runs;
  if (input.recover_orphan_runs === false) return expired_lock_runs;

  const orphan_runs = await find_orphan_running_runs(db, {
    ...input,
    limit: input.limit - expired_lock_runs.length,
  });
  return unique_runs([...expired_lock_runs, ...orphan_runs]);
}

async function find_expired_lock_runs(
  db: DatabaseExecutor,
  input: { workspace_id?: string | undefined; now: Date; limit: number },
) {
  const filters = [
    inArray(runs.run_status, active_run_statuses),
    // A held lock with a NULL expiry is as dead as an expired one — `lt(NULL, now)` is SQL
    // NULL, so without the isNull arm such a run is invisible to the reaper forever.
    or(isNull(sessions.lock_expires_time), lt(sessions.lock_expires_time, input.now)),
    no_job_will_continue_the_run(),
    ...(input.workspace_id ? [eq(runs.workspace_id, input.workspace_id)] : []),
  ];

  return db
    .select({
      run_id: runs.run_id,
      workspace_id: runs.workspace_id,
      session_id: runs.session_id,
    })
    .from(runs)
    .innerJoin(
      sessions,
      and(
        eq(sessions.workspace_id, runs.workspace_id),
        eq(sessions.session_id, runs.session_id),
        eq(sessions.locked_by_run_id, runs.run_id),
      ),
    )
    .where(and(...filters))
    .limit(input.limit);
}

async function find_orphan_running_runs(
  db: DatabaseExecutor,
  input: {
    workspace_id?: string | undefined;
    now: Date;
    orphan_stale_ms?: number;
    limit: number;
  },
) {
  const cutoff = new Date(input.now.getTime() - (input.orphan_stale_ms ?? orphan_running_run_ms));
  const filters = [
    inArray(runs.run_status, active_run_statuses),
    lt(runs.last_updated_time, cutoff),
    isNull(sessions.session_id),
    no_job_will_continue_the_run(),
    ...(input.workspace_id ? [eq(runs.workspace_id, input.workspace_id)] : []),
  ];

  return db
    .select({
      run_id: runs.run_id,
      workspace_id: runs.workspace_id,
      session_id: runs.session_id,
    })
    .from(runs)
    .leftJoin(
      sessions,
      and(
        eq(sessions.workspace_id, runs.workspace_id),
        eq(sessions.session_id, runs.session_id),
        eq(sessions.locked_by_run_id, runs.run_id),
      ),
    )
    .where(and(...filters))
    .limit(input.limit);
}

function no_job_will_continue_the_run() {
  return sql`not exists (
    select 1 from ${event_jobs}
    where ${event_jobs.workspace_id} = ${runs.workspace_id}
      and ${event_jobs.run_id} = ${runs.run_id}
      and ${event_jobs.job_status} in ('queued', 'running')
  )`;
}

function unique_runs<T extends { run_id: string }>(runs_to_recover: T[]) {
  const by_id = new Map<string, T>();
  for (const run of runs_to_recover) by_id.set(run.run_id, run);
  return [...by_id.values()];
}

export type CreateRunMessageInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  message_role: 'user' | 'assistant' | 'system' | 'tool_result' | 'event';
  message_content: MessageContent | ToolResultPointerContentData;
  content_text?: string | null;
  source_type: RunMessageSource;
  tool_call_id?: string | null;
  provider_item_id?: string | null;
  provider_call_id?: string | null;
  token_count?: number | null;
  is_model_visible?: boolean;
  is_user_visible?: boolean;
  source_metadata?: Record<string, unknown>;
  actor_id: string;
};

export async function create_run_message(db: Database, input: CreateRunMessageInput) {
  const [message] = await create_run_messages(db, [input]);
  return require_inserted_row(message, 'Run message');
}

export async function create_run_messages(db: Database, inputs: CreateRunMessageInput[]) {
  if (inputs.length === 0) return [];
  validate_run_message_batch(inputs);
  const normalized_inputs = inputs.map((input) => ({
    ...input,
    message_content: strip_unstorable_characters(input.message_content),
  }));
  const first = normalized_inputs[0] as (typeof normalized_inputs)[number];

  return write_after_earlier_writes(db, `run_messages:${first.session_id}`, () =>
    db.transaction(async (tx) => {
      // Updating the session takes the same row lock the old SELECT ... FOR UPDATE used. Doing the
      // visible session projection here removes a second round trip while preserving atomicity.
      await touch_session_for_messages(tx, normalized_inputs);
      const sequences = next_message_sequences_sql(first.session_id, first.run_id);

      return tx
        .insert(run_messages)
        .values(
          normalized_inputs.map((input, index) => ({
            run_message_id: create_id(id_prefixes.run_message),
            workspace_id: input.workspace_id,
            session_id: input.session_id,
            run_id: input.run_id,
            message_role: input.message_role,
            message_kind: get_message_kind(input.message_role, input.message_content),
            message_content: input.message_content as RunMessageContentData,
            content_text: stored_content_text(input.message_content, input.content_text),
            content_json: stored_content_json(input.message_content),
            tool_call_id: input.tool_call_id ?? null,
            provider_item_id: input.provider_item_id ?? null,
            provider_call_id: input.provider_call_id ?? null,
            token_count:
              input.token_count ?? estimate_model_visible_message_tokens(input.message_content),
            is_model_visible: input.is_model_visible ?? true,
            is_user_visible: input.is_user_visible ?? true,
            source_type: input.source_type,
            source_metadata: input.source_metadata ?? {},
            message_sequence: sql<number>`${sequences.message_sequence} + ${index}`,
            run_message_sequence: sql<number>`${sequences.run_message_sequence} + ${index}`,
            created_by: input.actor_id,
            last_updated_by: input.actor_id,
          })),
        )
        .returning();
    }),
  );
}

export async function replace_tool_result_message(
  db: Database,
  input: {
    workspace_id: string;
    run_id: string;
    tool_call_id: string;
    message_content: MessageContent | ToolResultPointerContentData;
    content_text?: string | null;
    token_count?: number;
    is_user_visible?: boolean;
    actor_id: string;
  },
) {
  const message_content = strip_unstorable_characters(input.message_content);
  const [message] = await db
    .update(run_messages)
    .set({
      message_content: message_content as RunMessageContentData,
      content_text: stored_content_text(
        message_content,
        strip_unstorable_characters(input.content_text),
      ),
      content_json: stored_content_json(message_content),
      token_count: input.token_count ?? estimate_model_visible_message_tokens(message_content),
      ...(input.is_user_visible === undefined ? {} : { is_user_visible: input.is_user_visible }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.run_id, input.run_id),
        eq(run_messages.tool_call_id, input.tool_call_id),
        eq(run_messages.message_role, 'tool_result'),
      ),
    )
    .returning();
  return message ?? null;
}

function stored_content_text(
  content: MessageContent | ToolResultPointerContentData,
  content_text: string | null | undefined,
) {
  if (content_text !== undefined) return content_text;
  return 'text' in content ? (content.text ?? null) : null;
}

function stored_content_json(content: MessageContent | ToolResultPointerContentData) {
  return 'data' in content ? (content.data ?? null) : null;
}

function validate_run_message_batch(inputs: CreateRunMessageInput[]) {
  const first = inputs[0];
  if (!first) return;
  const mixed_owner = inputs.some(
    (input) =>
      input.workspace_id !== first.workspace_id ||
      input.session_id !== first.session_id ||
      input.run_id !== first.run_id,
  );
  if (mixed_owner)
    throw new Error('A run-message batch must belong to one workspace, session, and run');
}

function next_message_sequences_sql(session_id: string, run_id: string) {
  return {
    message_sequence: sql`COALESCE((
      SELECT MAX(${run_messages.message_sequence})
      FROM ${run_messages}
      WHERE ${run_messages.session_id} = ${session_id}
    ), 0) + 1`,
    run_message_sequence: sql`COALESCE((
      SELECT MAX(${run_messages.run_message_sequence})
      FROM ${run_messages}
      WHERE ${run_messages.run_id} = ${run_id}
    ), 0) + 1`,
  };
}

export async function hide_run_messages_from_model(
  db: Database,
  input: {
    workspace_id: string;
    run_id: string;
    actor_id: string;
  },
) {
  const messages = await db
    .select({
      run_message_id: run_messages.run_message_id,
      message_role: run_messages.message_role,
      message_content: run_messages.message_content,
    })
    .from(run_messages)
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.run_id, input.run_id),
        eq(run_messages.message_role, 'assistant'),
      ),
    );

  const narrative_message_ids = messages
    .filter((message) => !message_contains_tool_call(message.message_content))
    .map((message) => message.run_message_id);
  if (narrative_message_ids.length === 0) return [];

  return db
    .update(run_messages)
    .set({
      is_model_visible: false,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.run_id, input.run_id),
        inArray(run_messages.run_message_id, narrative_message_ids),
      ),
    )
    .returning({ run_message_id: run_messages.run_message_id });
}

function message_contains_tool_call(message_content: RunMessageContentData) {
  const parts = message_content.parts ?? [];
  return parts.some((part) => part.type === 'tool_call');
}

export async function create_run_event(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    tool_call_id?: string | null;
    event_type: 'start' | 'progress' | 'message' | 'error' | 'end' | 'chat_event';
    event_label?: string | null;
    event_data?: unknown;
    event_metadata?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    actor_id: string;
  },
): Promise<typeof run_events.$inferSelect> {
  const [event] = await create_run_events(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    events: [
      {
        tool_call_id: input.tool_call_id ?? null,
        event_type: input.event_type,
        event_label: input.event_label ?? null,
        event_data: input.event_data,
        event_metadata: input.event_metadata,
        metadata: input.metadata,
      },
    ],
  });

  return require_inserted_row(event, 'Run event');
}

export type RunEventToCreate = {
  tool_call_id?: string | null | undefined;
  event_type: 'start' | 'progress' | 'message' | 'error' | 'end' | 'chat_event';
  event_label?: string | null | undefined;
  event_data?: unknown;
  event_metadata?: Record<string, unknown> | undefined;
  metadata?: Record<string, unknown> | undefined;
};

// Writes a batch of run events in order with one insert: each row takes the run's
// `MAX(event_sequence)` plus its position in the batch. The run lock is its own statement, so the
// insert's READ COMMITTED snapshot starts after the wait and reads what the previous holder wrote.
// Inside the insert's SELECT list it serialized nothing: two writers read the same mark and hit
// `idx_run_events_run_sequence_unique`. Writers of one process queue first, so a waiting writer
// holds no pooled connection.
export async function create_run_events(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    events: RunEventToCreate[];
    actor_id: string;
  },
): Promise<(typeof run_events.$inferSelect)[]> {
  if (input.events.length === 0) return [];

  const inserted = await write_after_earlier_writes(db, `run_events:${input.run_id}`, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('run_events'), hashtext(${input.run_id}))`,
      );
      return insert_run_events_after_high_water(tx, input);
    }),
  );

  const returned = read_execute_rows<typeof run_events.$inferSelect>(inserted);
  if (returned.length !== input.events.length) {
    throw new Error(
      `Run event batch inserted ${returned.length} of ${input.events.length} rows for run ${input.run_id}`,
    );
  }
  return returned.sort((left, right) => left.event_sequence - right.event_sequence);
}

function insert_run_events_after_high_water(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    events: RunEventToCreate[];
    actor_id: string;
  },
) {
  const values = sql.join(
    input.events.map(
      (event, index) =>
        sql`(${create_id(id_prefixes.run_event)}, ${index + 1}::int, ${event.tool_call_id ?? null}, ${event.event_type}, ${event.event_label ?? null}, ${JSON.stringify(strip_unstorable_characters(event.event_data ?? {}))}::jsonb, ${JSON.stringify(strip_unstorable_characters(event.event_metadata ?? {}))}::jsonb, ${JSON.stringify(event.metadata ?? {})}::jsonb)`,
    ),
    sql`, `,
  );

  return db.execute(sql`
    WITH batch (run_event_id, position, tool_call_id, event_type, event_label, event_data, event_metadata, metadata) AS (
      VALUES ${values}
    ),
    allocated AS (
      SELECT COALESCE(MAX(${run_events.event_sequence}), 0) AS high_water
      FROM ${run_events}
      WHERE ${run_events.run_id} = ${input.run_id}
    )
    INSERT INTO ${run_events} (
      run_event_id, workspace_id, session_id, run_id, tool_call_id,
      event_sequence, event_type, event_label, event_data, event_metadata, metadata,
      created_by, last_updated_by
    )
    SELECT batch.run_event_id, ${input.workspace_id}, ${input.session_id}, ${input.run_id}, batch.tool_call_id,
           allocated.high_water + batch.position, batch.event_type, batch.event_label,
           batch.event_data, batch.event_metadata, batch.metadata,
           ${input.actor_id}, ${input.actor_id}
    FROM batch, allocated
    ORDER BY batch.position
    RETURNING *
  `);
}

type RunModelContextSnapshotKind =
  | 'runtime_context'
  | 'engine_input'
  | 'provider_payload'
  | 'compaction';

export async function create_run_model_context_snapshot(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    snapshot_kind: RunModelContextSnapshotKind;
    snapshot_sequence?: number;
    model_provider?: string | null;
    model_name?: string | null;
    message_count: number;
    tool_count: number;
    token_estimate: number;
    snapshot: unknown;
    snapshot_metadata?: Record<string, unknown>;
    actor_id: string;
  },
): Promise<typeof run_model_context_snapshots.$inferSelect> {
  if (input.snapshot_sequence === undefined) {
    return create_run_model_context_snapshot_with_allocated_sequence(db, input);
  }

  const [snapshot] = await db
    .insert(run_model_context_snapshots)
    .values({
      run_model_context_snapshot_id: create_id(id_prefixes.run_model_context_snapshot),
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      snapshot_kind: input.snapshot_kind,
      snapshot_sequence: input.snapshot_sequence,
      model_provider: input.model_provider ?? null,
      model_name: input.model_name ?? null,
      message_count: input.message_count,
      tool_count: input.tool_count,
      token_estimate: input.token_estimate,
      snapshot: input.snapshot,
      snapshot_metadata: input.snapshot_metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(snapshot, 'Run model context snapshot');
}

async function create_run_model_context_snapshot_with_allocated_sequence(
  db: DatabaseExecutor,
  input: Omit<Parameters<typeof create_run_model_context_snapshot>[1], 'snapshot_sequence'>,
): Promise<typeof run_model_context_snapshots.$inferSelect> {
  let last_error: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await create_run_model_context_snapshot(db, {
        ...input,
        snapshot_sequence: await get_next_run_model_context_snapshot_sequence(db, {
          run_id: input.run_id,
          snapshot_kind: input.snapshot_kind,
        }),
      });
    } catch (error) {
      if (!is_run_model_context_snapshot_sequence_conflict(error)) throw error;
      last_error = error;
    }
  }

  throw last_error;
}

function is_run_model_context_snapshot_sequence_conflict(error: unknown) {
  const details = find_database_error_details(error);
  return (
    details?.code === '23505' &&
    (details.constraint_name === 'idx_run_model_context_snapshots_run_kind_sequence_unique' ||
      details.constraint_name === undefined)
  );
}

async function get_next_run_model_context_snapshot_sequence(
  db: DatabaseExecutor,
  input: { run_id: string; snapshot_kind: RunModelContextSnapshotKind },
) {
  const result = await db
    .select({
      next_sequence: sql<number>`COALESCE(MAX(${run_model_context_snapshots.snapshot_sequence}), 0) + 1`,
    })
    .from(run_model_context_snapshots)
    .where(
      and(
        eq(run_model_context_snapshots.run_id, input.run_id),
        eq(run_model_context_snapshots.snapshot_kind, input.snapshot_kind),
      ),
    );

  return result[0]?.next_sequence ?? 1;
}

export async function list_session_messages_for_model_context(
  db: Database,
  workspace_id: string,
  session_id: string,
  input: { limit: number },
) {
  const newest_first = await db
    .select({
      run_message_id: run_messages.run_message_id,
      message_role: run_messages.message_role,
      message_content: run_messages.message_content,
      tool_call_id: run_messages.tool_call_id,
      is_model_visible: run_messages.is_model_visible,
      token_count: run_messages.token_count,
      message_sequence: run_messages.message_sequence,
    })
    .from(run_messages)
    .where(
      and(
        eq(run_messages.workspace_id, workspace_id),
        eq(run_messages.session_id, session_id),
        eq(run_messages.is_model_visible, true),
        inArray(run_messages.message_role, ['user', 'assistant', 'tool_result']),
      ),
    )
    .orderBy(desc(run_messages.message_sequence))
    .limit(input.limit);

  return newest_first.reverse();
}

export async function latest_session_in_project(
  db: Database,
  input: { workspace_id: string; project_id: string },
) {
  return (
    (await db.query.sessions.findFirst({
      where: and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.project_id, input.project_id),
      ),
      orderBy: (table, { desc }) => [desc(table.last_updated_time)],
    })) ?? null
  );
}

export async function list_session_messages(
  db: Database,
  workspace_id: string,
  session_id: string,
) {
  return db.query.run_messages.findMany({
    where: and(
      eq(run_messages.workspace_id, workspace_id),
      eq(run_messages.session_id, session_id),
    ),
    orderBy: (table, { asc }) => [asc(table.message_sequence)],
  });
}

export async function list_session_messages_containing_text(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    query: string;
    limit?: number;
  },
) {
  const trimmed_query = input.query.trim();
  if (!trimmed_query) return [];

  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const pattern = `%${trimmed_query}%`;

  return db.query.run_messages.findMany({
    where: and(
      eq(run_messages.workspace_id, input.workspace_id),
      eq(run_messages.session_id, input.session_id),
      eq(run_messages.is_user_visible, true),
      sql`(${run_messages.content_text} ILIKE ${pattern} OR ${run_messages.message_content}::text ILIKE ${pattern} OR ${stored_tool_result_matches(pattern)})`,
    ),
    orderBy: (table, { desc }) => [desc(table.message_sequence)],
    limit,
  });
}

function stored_tool_result_matches(pattern: string) {
  return sql`(${run_messages.message_content} ? 'shape' AND EXISTS (
    SELECT 1 FROM tool_calls stored_call
    WHERE stored_call.workspace_id = ${run_messages.workspace_id}
      AND stored_call.tool_call_id = ${run_messages.tool_call_id}
      AND (stored_call.output_text ILIKE ${pattern} OR stored_call.output_data::text ILIKE ${pattern})
  ))`;
}

export async function list_run_messages(db: Database, workspace_id: string, run_id: string) {
  return db.query.run_messages.findMany({
    where: and(eq(run_messages.workspace_id, workspace_id), eq(run_messages.run_id, run_id)),
    orderBy: (table, { asc }) => [asc(table.message_sequence)],
  });
}

export async function find_run_resumed_from_job(
  db: Database,
  input: { workspace_id: string; resumed_from_job_id: string },
) {
  return (
    (await db.query.runs.findFirst({
      where: and(
        eq(runs.workspace_id, input.workspace_id),
        eq(runs.resumed_from_job_id, input.resumed_from_job_id),
      ),
    })) ?? null
  );
}

export type RunTriggerType =
  | 'user_message'
  | 'slack_event'
  | 'schedule'
  | 'api'
  | 'app_event'
  | 'manual'
  | 'manual_retry';

export async function create_run(
  db: Database,
  input: {
    run_id?: string;
    workspace_id: string;
    session_id: string;
    agent_id: string;
    trigger_type: RunTriggerType;
    actor_id: string;
    trigger_id?: string | null;
    automation_id?: string | null;
    parent_run_id?: string | null;
    root_run_id?: string | null;
    resumed_from_job_id?: string | null;
    model_provider?: string | null;
    model_proxy?: string | null;
    model_name?: string | null;
    run_metadata?: Record<string, unknown>;
  },
) {
  const run_id = input.run_id ?? create_id(id_prefixes.run);
  const run_metadata = {
    ...(input.model_proxy ? { model_proxy: input.model_proxy } : {}),
    ...input.run_metadata,
  };
  const [run] = await db
    .insert(runs)
    .values({
      run_id,
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      agent_id: input.agent_id,
      trigger_id: input.trigger_id ?? null,
      automation_id: input.automation_id ?? null,
      parent_run_id: input.parent_run_id ?? null,
      root_run_id: input.root_run_id ?? run_id,
      resumed_from_job_id: input.resumed_from_job_id ?? null,
      trigger_type: input.trigger_type,
      run_reason: get_run_reason_from_trigger_type(input.trigger_type),
      run_status: 'queued',
      model_provider: input.model_provider ?? null,
      provider_name: input.model_provider ?? null,
      model_name: input.model_name ?? null,
      ...(Object.keys(run_metadata).length > 0 ? { run_metadata } : {}),
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(run, 'Run');
}

export async function update_run_status(
  db: Database,
  input: {
    run_id: string;
    run_status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    actor_id: string;
    error_message?: string | null;
    error_code?: string | null;
    current_run_statuses?: Array<'queued' | 'starting' | 'running' | 'waiting'>;
  },
) {
  const now = new Date();
  const status_filters = [
    eq(runs.run_id, input.run_id),
    ...(input.current_run_statuses ? [inArray(runs.run_status, input.current_run_statuses)] : []),
  ];
  const [run] = await db
    .update(runs)
    .set({
      run_status: input.run_status,
      started_time: input.run_status === 'running' ? now : undefined,
      completed_time: ['completed', 'failed', 'cancelled'].includes(input.run_status)
        ? now
        : undefined,
      finished_time: ['completed', 'failed', 'cancelled'].includes(input.run_status)
        ? now
        : undefined,
      error_message: strip_unstorable_characters(input.error_message ?? null),
      error_code: input.error_code ?? null,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(and(...status_filters))
    .returning();

  if (run) return run;

  const existing_run = await db.query.runs.findFirst({
    where: eq(runs.run_id, input.run_id),
  });
  return require_inserted_row(existing_run, 'Run');
}

export async function add_usage_to_run_totals(
  db: Database,
  input: {
    run_id: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cost_microcents?: number;
    usage_metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [run] = await db
    .update(runs)
    .set({
      input_tokens: sql`${runs.input_tokens} + ${input.input_tokens ?? 0}`,
      output_tokens: sql`${runs.output_tokens} + ${input.output_tokens ?? 0}`,
      cache_read_tokens: sql`${runs.cache_read_tokens} + ${input.cache_read_tokens ?? 0}`,
      cache_write_tokens: sql`${runs.cache_write_tokens} + ${input.cache_write_tokens ?? 0}`,
      cost_microcents: sql`${runs.cost_microcents} + ${input.cost_microcents ?? 0}`,
      usage_metadata: merge_metadata(runs.usage_metadata, input.usage_metadata ?? {}),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(runs.run_id, input.run_id))
    .returning();

  return require_inserted_row(run, 'Run');
}

export async function update_run_performance_metrics(
  db: Database,
  input: {
    run_id: string;
    context_compile_ms?: number;
    engine_first_event_ms?: number;
    model_total_ms?: number;
    tool_total_ms?: number;
    db_write_total_ms?: number;
    total_run_ms?: number;
    actor_id: string;
  },
) {
  const [run] = await db
    .update(runs)
    .set({
      context_compile_ms: input.context_compile_ms ?? 0,
      engine_first_event_ms: input.engine_first_event_ms ?? 0,
      model_total_ms: input.model_total_ms ?? 0,
      tool_total_ms: input.tool_total_ms ?? 0,
      db_write_total_ms: input.db_write_total_ms ?? 0,
      total_run_ms: input.total_run_ms ?? 0,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(runs.run_id, input.run_id))
    .returning();

  return require_inserted_row(run, 'Run');
}

export async function list_session_runs(db: Database, workspace_id: string, session_id: string) {
  return db.query.runs.findMany({
    where: and(eq(runs.workspace_id, workspace_id), eq(runs.session_id, session_id)),
    orderBy: [desc(runs.created_time)],
  });
}

export async function get_run(db: Database, workspace_id: string, run_id: string) {
  return db.query.runs.findFirst({
    where: and(eq(runs.workspace_id, workspace_id), eq(runs.run_id, run_id)),
  });
}

export async function claim_run_turn_finalize(
  db: Database,
  input: {
    workspace_id: string;
    run_id: string;
    actor_id: string;
    claimed_by: string;
  },
) {
  const claim = {
    turn_finalize: {
      claimed_by: input.claimed_by,
      claimed_time: new Date().toISOString(),
    },
  };
  const [claimed] = await db
    .update(runs)
    .set({
      run_metadata: sql`${runs.run_metadata} || ${JSON.stringify(claim)}::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        eq(runs.run_id, input.run_id),
        sql`${runs.run_metadata} -> 'turn_finalize' IS NULL`,
      ),
    )
    .returning({ run_id: runs.run_id });

  return Boolean(claimed);
}

export async function record_run_turn_finalize_outcome(
  db: Database,
  input: {
    workspace_id: string;
    run_id: string;
    actor_id: string;
    outcome: string;
    outcome_data?: Record<string, unknown>;
  },
) {
  const outcome = { outcome: input.outcome, ...input.outcome_data };
  await db
    .update(runs)
    .set({
      run_metadata: sql`jsonb_set(${runs.run_metadata}, '{turn_finalize}', COALESCE(${runs.run_metadata}->'turn_finalize', '{}'::jsonb) || ${JSON.stringify(outcome)}::jsonb)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(runs.workspace_id, input.workspace_id), eq(runs.run_id, input.run_id)));
}

export async function list_runs_by_ids(db: Database, workspace_id: string, run_ids: string[]) {
  const unique_run_ids = [...new Set(run_ids)];
  if (unique_run_ids.length === 0) return [];

  return db.query.runs.findMany({
    where: and(eq(runs.workspace_id, workspace_id), inArray(runs.run_id, unique_run_ids)),
    orderBy: [desc(runs.created_time), desc(runs.run_id)],
  });
}

export async function list_runs_still_in_progress(
  db: Database,
  input: { workspace_id: string; run_ids: string[]; now?: Date },
) {
  const unique_run_ids = [...new Set(input.run_ids)];
  if (unique_run_ids.length === 0) return [];

  const now = input.now ?? new Date();
  return db
    .select({ run_id: runs.run_id, run_status: runs.run_status })
    .from(runs)
    .leftJoin(
      sessions,
      and(
        eq(sessions.workspace_id, runs.workspace_id),
        eq(sessions.session_id, runs.session_id),
        eq(sessions.locked_by_run_id, runs.run_id),
      ),
    )
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        inArray(runs.run_id, unique_run_ids),
        or(
          eq(runs.run_status, 'waiting'),
          and(
            inArray(runs.run_status, ['queued', 'starting', 'running']),
            gt(sessions.lock_expires_time, now),
          ),
        ),
      ),
    );
}

export async function create_tool_call_started(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    agent_id?: string;
    node_id?: string | null;
    node_version?: number | null;
    tool_name: string;
    tool_input: ToolInputData;
    tool_status?: string;
    risk_class?: string | null;
    approval_mode?: string | null;
    idempotency_key?: string | null;
    tool_call_metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [tool_call] = await db
    .insert(tool_calls)
    .values({
      tool_call_id: create_id(id_prefixes.tool_call),
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      agent_id: input.agent_id ?? '',
      node_id: input.node_id ?? null,
      node_version: input.node_version ?? null,
      tool_name: input.tool_name,
      tool_status: input.tool_status ?? 'executing',
      risk_class: input.risk_class ?? null,
      approval_mode: input.approval_mode ?? null,
      idempotency_key: input.idempotency_key ?? null,
      input_data: strip_unstorable_characters(input.tool_input),
      tool_call_metadata: strip_unstorable_characters(input.tool_call_metadata ?? {}),
      started_time: new Date(),
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(tool_call, 'Tool call');
}

export async function update_tool_call_finished(
  db: Database,
  input: {
    tool_call_id: string;
    tool_status: 'completed' | 'failed' | 'blocked' | 'timed_out' | 'cancelled' | 'denied';
    output?: unknown;
    output_text?: string | null;
    output_file_id?: string | null;
    error_code?: string | null;
    error_message?: string | null;
    node_id?: string | null;
    node_version?: number | null;
    connection_id?: string | null;
    tool_call_metadata_patch?: Record<string, unknown>;
    duration_ms: number;
    actor_id: string;
  },
) {
  const [tool_call] = await db
    .update(tool_calls)
    .set({
      tool_status: input.tool_status,
      ...(input.output === undefined
        ? {}
        : { output_data: strip_unstorable_characters(input.output) }),
      ...(input.output_text === undefined
        ? {}
        : { output_text: strip_unstorable_characters(input.output_text) }),
      ...(input.output_file_id === undefined ? {} : { output_file_id: input.output_file_id }),
      error_code: input.error_code ?? null,
      error_message: strip_unstorable_characters(input.error_message ?? null),
      ...(input.node_id === undefined ? {} : { node_id: input.node_id }),
      ...(input.node_version === undefined ? {} : { node_version: input.node_version }),
      ...(input.connection_id === undefined ? {} : { connection_id: input.connection_id }),
      ...(input.tool_call_metadata_patch === undefined
        ? {}
        : {
            tool_call_metadata: sql`${tool_calls.tool_call_metadata} || ${JSON.stringify(strip_unstorable_characters(input.tool_call_metadata_patch))}::jsonb`,
          }),
      duration_ms: input.duration_ms,
      completed_time: new Date(),
      finished_time: new Date(),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(tool_calls.tool_call_id, input.tool_call_id))
    .returning();

  return require_inserted_row(tool_call, 'Tool call');
}

export async function hold_tool_call_for_approval(
  db: Database,
  input: {
    workspace_id: string;
    tool_call_id: string;
    tool_call_metadata_patch: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [tool_call] = await db
    .update(tool_calls)
    .set({
      tool_status: 'awaiting_approval',
      tool_call_metadata: sql`${tool_calls.tool_call_metadata} || ${JSON.stringify(strip_unstorable_characters(input.tool_call_metadata_patch))}::jsonb`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        eq(tool_calls.tool_call_id, input.tool_call_id),
        inArray(tool_calls.tool_status, ['pending', 'executing']),
      ),
    )
    .returning();

  return tool_call ?? null;
}

export async function set_tool_call_output(
  db: Database,
  input: {
    tool_call_id: string;
    output_data: unknown;
    output_text: string | null;
    output_file_id: string | null;
    actor_id: string;
  },
) {
  const [tool_call] = await db
    .update(tool_calls)
    .set({
      output_data: strip_unstorable_characters(input.output_data),
      output_text: strip_unstorable_characters(input.output_text),
      ...(input.output_file_id === null ? {} : { output_file_id: input.output_file_id }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(tool_calls.tool_call_id, input.tool_call_id))
    .returning();

  return require_inserted_row(tool_call, 'Tool call');
}

export async function find_runtime_environment_by_mount_key(
  db: Database,
  input: {
    workspace_id: string;
    environment_provider: string;
    workspace_mount_key: string;
  },
) {
  return db.query.runtime_environments.findFirst({
    where: and(
      eq(runtime_environments.workspace_id, input.workspace_id),
      eq(runtime_environments.environment_provider, input.environment_provider),
      eq(runtime_environments.workspace_mount_key, input.workspace_mount_key),
    ),
  });
}

export async function get_runtime_environment(
  db: Database,
  input: { workspace_id: string; runtime_environment_id: string },
) {
  return db.query.runtime_environments.findFirst({
    where: and(
      eq(runtime_environments.workspace_id, input.workspace_id),
      eq(runtime_environments.runtime_environment_id, input.runtime_environment_id),
    ),
  });
}

export async function create_runtime_environment(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string | null;
    agent_id: string | null;
    environment_provider: string;
    environment_status: string;
    provider_environment_id?: string | null;
    workspace_mount_key: string;
    root_path: string;
    environment_config?: Record<string, unknown>;
    environment_metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [environment] = await db
    .insert(runtime_environments)
    .values({
      runtime_environment_id: create_id(id_prefixes.runtime_environment),
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      agent_id: input.agent_id,
      environment_provider: input.environment_provider,
      environment_status: input.environment_status,
      provider_environment_id: input.provider_environment_id ?? null,
      workspace_mount_key: input.workspace_mount_key,
      root_path: input.root_path,
      environment_config: input.environment_config ?? {},
      environment_metadata: input.environment_metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(environment, 'Runtime environment');
}

export async function update_runtime_environment_state(
  db: Database,
  input: {
    runtime_environment_id: string;
    environment_status: string;
    provider_environment_id?: string | null;
    environment_config?: Record<string, unknown>;
    environment_metadata?: Record<string, unknown>;
    merge_environment_metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [environment] = await db
    .update(runtime_environments)
    .set({
      environment_status: input.environment_status,
      ...(input.provider_environment_id === undefined
        ? {}
        : { provider_environment_id: input.provider_environment_id }),
      ...(input.environment_config === undefined
        ? {}
        : { environment_config: input.environment_config }),
      ...(input.environment_metadata === undefined
        ? {}
        : { environment_metadata: input.environment_metadata }),
      ...(input.merge_environment_metadata === undefined
        ? {}
        : {
            environment_metadata: sql`coalesce(${runtime_environments.environment_metadata}, '{}'::jsonb) || ${JSON.stringify(input.merge_environment_metadata)}::jsonb`,
          }),
      last_heartbeat_time: new Date(),
      ...(input.environment_status === 'running' ? { last_started_time: new Date() } : {}),
      ...(input.environment_status === 'stopped' || input.environment_status === 'idle'
        ? { last_stopped_time: new Date() }
        : {}),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(runtime_environments.runtime_environment_id, input.runtime_environment_id))
    .returning();

  return require_inserted_row(environment, 'Runtime environment');
}

export async function upsert_runtime_environment_active_preview(
  db: Database,
  input: {
    runtime_environment_id: string;
    active_preview: Record<string, unknown>;
    preview_port: number;
    environment_status?: string;
    actor_id: string;
  },
) {
  const active_preview = { ...input.active_preview, port: input.preview_port };
  const active_preview_json = JSON.stringify(active_preview);
  const preview_port_key = String(input.preview_port);
  const preview_port_json = JSON.stringify([input.preview_port]);
  const started_time = new Date().toISOString();
  const existing_previews = sql`
    case
      when jsonb_typeof(${runtime_environments.environment_metadata}->'active_previews') = 'object'
        then ${runtime_environments.environment_metadata}->'active_previews'
      else '{}'::jsonb
    end
  `;
  const existing_ports = sql`
    case
      when jsonb_typeof(${runtime_environments.environment_metadata}->'active_preview_ports') = 'array'
        then ${runtime_environments.environment_metadata}->'active_preview_ports'
      else '[]'::jsonb
    end
  `;
  const [environment] = await db
    .update(runtime_environments)
    .set({
      ...(input.environment_status ? { environment_status: input.environment_status } : {}),
      environment_metadata: sql`
        coalesce(${runtime_environments.environment_metadata}, '{}'::jsonb) ||
        jsonb_build_object(
          'active_preview', ${active_preview_json}::jsonb,
          'active_previews',
            ${existing_previews} ||
            jsonb_build_object(${preview_port_key}::text, ${active_preview_json}::jsonb),
          'active_preview_ports',
            case
              when ${existing_ports} @> ${preview_port_json}::jsonb
                then ${existing_ports}
              else ${existing_ports} || ${preview_port_json}::jsonb
            end,
          'last_preview_started_time', ${started_time}::text
        )
      `,
      last_heartbeat_time: new Date(),
      ...(input.environment_status === 'running' ? { last_started_time: new Date() } : {}),
      ...(input.environment_status === 'stopped' || input.environment_status === 'idle'
        ? { last_stopped_time: new Date() }
        : {}),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(runtime_environments.runtime_environment_id, input.runtime_environment_id))
    .returning();

  return require_inserted_row(environment, 'Runtime environment');
}

export async function claim_runtime_environment_close(
  db: Database,
  input: { runtime_environment_id: string; actor_id: string },
) {
  const [environment] = await db
    .update(runtime_environments)
    .set({
      environment_status: 'stopping',
      last_heartbeat_time: new Date(),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(runtime_environments.runtime_environment_id, input.runtime_environment_id),
        inArray(runtime_environments.environment_status, [
          'pending',
          'starting',
          'running',
          'failed',
        ]),
      ),
    )
    .returning();

  return environment ?? null;
}

export async function update_session_runtime_environment(
  db: Database,
  input: {
    session_id: string;
    runtime_environment_id: string;
    actor_id: string;
  },
) {
  const [session] = await db
    .update(sessions)
    .set({
      runtime_environment_id: input.runtime_environment_id,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(sessions.session_id, input.session_id))
    .returning();

  return require_inserted_row(session, 'Session');
}

export async function find_sandbox_by_mount_key(
  db: Database,
  input: {
    workspace_id: string;
    sandbox_provider: string;
    workspace_mount_key: string;
  },
) {
  return db.query.sandboxes.findFirst({
    where: and(
      eq(sandboxes.workspace_id, input.workspace_id),
      eq(sandboxes.sandbox_provider, input.sandbox_provider),
      eq(sandboxes.workspace_mount_key, input.workspace_mount_key),
    ),
  });
}

export async function upsert_sandbox_by_mount_key(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    session_id: string;
    runtime_environment_id: string;
    sandbox_provider: string;
    sandbox_status: string;
    provider_sandbox_id?: string | null;
    provider_template_id?: string | null;
    workspace_mount_key: string;
    root_path: string;
    working_directory: string;
    sandbox_config?: Record<string, unknown>;
    sandbox_metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [sandbox] = await db
    .insert(sandboxes)
    .values({
      sandbox_id: create_id(id_prefixes.sandbox),
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
      session_id: input.session_id,
      runtime_environment_id: input.runtime_environment_id,
      sandbox_provider: input.sandbox_provider,
      sandbox_status: input.sandbox_status,
      provider_sandbox_id: input.provider_sandbox_id ?? null,
      provider_template_id: input.provider_template_id ?? null,
      workspace_mount_key: input.workspace_mount_key,
      root_path: input.root_path,
      working_directory: input.working_directory,
      sandbox_config: input.sandbox_config ?? {},
      sandbox_metadata: input.sandbox_metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoUpdate({
      target: [sandboxes.workspace_id, sandboxes.sandbox_provider, sandboxes.workspace_mount_key],
      set: {
        agent_id: input.agent_id,
        session_id: input.session_id,
        runtime_environment_id: input.runtime_environment_id,
        sandbox_status: input.sandbox_status,
        ...(input.provider_sandbox_id === undefined
          ? {}
          : { provider_sandbox_id: input.provider_sandbox_id }),
        ...(input.provider_template_id === undefined
          ? {}
          : { provider_template_id: input.provider_template_id }),
        ...(input.sandbox_config === undefined ? {} : { sandbox_config: input.sandbox_config }),
        ...(input.sandbox_metadata === undefined
          ? {}
          : { sandbox_metadata: input.sandbox_metadata }),
        last_heartbeat_time: new Date(),
        ...(input.sandbox_status === 'running' ? { last_started_time: new Date() } : {}),
        ...(input.sandbox_status === 'paused' ? { last_paused_time: new Date() } : {}),
        ...(input.sandbox_status === 'stopped' ? { last_stopped_time: new Date() } : {}),
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      },
    })
    .returning();

  return require_inserted_row(sandbox, 'Sandbox');
}

export async function update_sandbox_state(
  db: Database,
  input: {
    sandbox_id: string;
    sandbox_status: string;
    provider_sandbox_id?: string | null;
    provider_template_id?: string | null;
    runtime_environment_id?: string | null;
    sandbox_config?: Record<string, unknown>;
    sandbox_metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [sandbox] = await db
    .update(sandboxes)
    .set({
      sandbox_status: input.sandbox_status,
      ...(input.provider_sandbox_id === undefined
        ? {}
        : { provider_sandbox_id: input.provider_sandbox_id }),
      ...(input.provider_template_id === undefined
        ? {}
        : { provider_template_id: input.provider_template_id }),
      ...(input.runtime_environment_id === undefined
        ? {}
        : { runtime_environment_id: input.runtime_environment_id }),
      ...(input.sandbox_config === undefined ? {} : { sandbox_config: input.sandbox_config }),
      ...(input.sandbox_metadata === undefined ? {} : { sandbox_metadata: input.sandbox_metadata }),
      last_heartbeat_time: new Date(),
      ...(input.sandbox_status === 'running' ? { last_started_time: new Date() } : {}),
      ...(input.sandbox_status === 'paused' ? { last_paused_time: new Date() } : {}),
      ...(input.sandbox_status === 'stopped' ? { last_stopped_time: new Date() } : {}),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(sandboxes.sandbox_id, input.sandbox_id))
    .returning();

  return require_inserted_row(sandbox, 'Sandbox');
}

export async function list_run_tool_calls(db: Database, workspace_id: string, run_id: string) {
  return db.query.tool_calls.findMany({
    where: and(eq(tool_calls.workspace_id, workspace_id), eq(tool_calls.run_id, run_id)),
    orderBy: (table, { asc }) => [asc(table.created_time)],
  });
}

export async function count_workspace_tool_calls_since(
  db: Database,
  input: { workspace_id: string; tool_names: string[]; since: Date },
): Promise<number> {
  if (input.tool_names.length === 0) return 0;
  const [row] = await db
    .select({ call_count: sql<number>`count(*)::int` })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        inArray(tool_calls.tool_name, input.tool_names),
        gte(tool_calls.created_time, input.since),
      ),
    );
  return row?.call_count ?? 0;
}

export async function list_session_tool_calls(
  db: Database,
  workspace_id: string,
  session_id: string,
) {
  return db.query.tool_calls.findMany({
    where: and(eq(tool_calls.workspace_id, workspace_id), eq(tool_calls.session_id, session_id)),
    orderBy: (table, { asc }) => [asc(table.created_time)],
  });
}

export async function find_tool_call_by_idempotency_key(
  db: Database,
  input: { workspace_id: string; idempotency_key: string },
) {
  return (
    (await db.query.tool_calls.findFirst({
      where: and(
        eq(tool_calls.workspace_id, input.workspace_id),
        eq(tool_calls.idempotency_key, input.idempotency_key),
      ),
    })) ?? null
  );
}

export async function get_tool_call(db: Database, workspace_id: string, tool_call_id: string) {
  return db.query.tool_calls.findFirst({
    where: and(
      eq(tool_calls.workspace_id, workspace_id),
      eq(tool_calls.tool_call_id, tool_call_id),
    ),
  });
}

/**
 * Persist cancel intent without flipping run_status. The run loop polls
 * cancel_requested_time and aborts mid-flight tool calls; the terminal
 * status transition still happens via cancel_run / mark_run_cancelled.
 *
 * Idempotent: re-requesting cancel preserves the first cancel_requested_time.
 */
export async function request_run_cancellation(
  db: Database,
  workspace_id: string,
  run_id: string,
  actor_id: string,
) {
  const now = new Date();
  const now_iso = now.toISOString();
  const [run] = await db
    .update(runs)
    .set({
      cancel_requested_time: sql`COALESCE(${runs.cancel_requested_time}, ${now_iso}::timestamptz)`,
      cancel_requested_by: sql`COALESCE(${runs.cancel_requested_by}, ${actor_id})`,
      last_updated_time: now,
      last_updated_by: actor_id,
    })
    .where(
      and(
        eq(runs.workspace_id, workspace_id),
        eq(runs.run_id, run_id),
        inArray(runs.run_status, ['queued', 'starting', 'running', 'waiting']),
      ),
    )
    .returning();

  if (run) return run;
  const existing_run = await get_run(db, workspace_id, run_id);
  return require_inserted_row(existing_run, 'Run');
}

export async function get_run_cancel_intent(
  db: Database,
  workspace_id: string,
  run_id: string,
): Promise<{ cancel_requested_time: Date | null } | null> {
  const row = await db.query.runs.findFirst({
    columns: { cancel_requested_time: true },
    where: and(eq(runs.workspace_id, workspace_id), eq(runs.run_id, run_id)),
  });
  return row ?? null;
}

export async function cancel_run(
  db: Database,
  workspace_id: string,
  run_id: string,
  actor_id: string,
) {
  const now = new Date();
  const [run] = await db
    .update(runs)
    .set({
      run_status: 'cancelled',
      completed_time: now,
      finished_time: now,
      last_updated_time: now,
      last_updated_by: actor_id,
    })
    .where(
      and(
        eq(runs.workspace_id, workspace_id),
        eq(runs.run_id, run_id),
        inArray(runs.run_status, ['queued', 'starting', 'running', 'waiting']),
      ),
    )
    .returning();

  if (run) return run;

  const existing_run = await get_run(db, workspace_id, run_id);
  return require_inserted_row(existing_run, 'Run');
}

export async function list_run_events(
  db: Database,
  workspace_id: string,
  run_id: string,
  input: {
    tool_call_id?: string;
    event_type?: string;
    after_sequence?: number;
    limit?: number;
  } = {},
) {
  return db.query.run_events.findMany({
    where: and(
      eq(run_events.workspace_id, workspace_id),
      eq(run_events.run_id, run_id),
      ...(input.tool_call_id ? [eq(run_events.tool_call_id, input.tool_call_id)] : []),
      ...(input.event_type ? [eq(run_events.event_type, input.event_type)] : []),
      ...(input.after_sequence !== undefined
        ? [gt(run_events.event_sequence, input.after_sequence)]
        : []),
    ),
    orderBy: (table, { asc }) => [asc(table.event_sequence)],
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}

export async function list_run_chat_events(
  db: Database,
  workspace_id: string,
  run_id: string,
  input: { after_sequence?: number } = {},
) {
  return db
    .select({
      run_event_id: run_events.run_event_id,
      workspace_id: run_events.workspace_id,
      session_id: run_events.session_id,
      run_id: run_events.run_id,
      event_sequence: run_events.event_sequence,
      event_type: run_events.event_type,
      event_label: run_events.event_label,
      event_data: sql<ChatStreamEventDraft>`${run_events.event_data}`,
      created_time: run_events.created_time,
    })
    .from(run_events)
    .where(
      and(
        eq(run_events.workspace_id, workspace_id),
        eq(run_events.run_id, run_id),
        eq(run_events.event_type, 'chat_event'),
        ...(input.after_sequence === undefined
          ? []
          : [gt(run_events.event_sequence, input.after_sequence)]),
      ),
    )
    .orderBy(asc(run_events.event_sequence));
}

export async function list_run_model_context_snapshots(
  db: Database,
  workspace_id: string,
  run_id: string,
) {
  return db.query.run_model_context_snapshots.findMany({
    where: and(
      eq(run_model_context_snapshots.workspace_id, workspace_id),
      eq(run_model_context_snapshots.run_id, run_id),
    ),
    orderBy: (table, { asc }) => [asc(table.snapshot_sequence), asc(table.created_time)],
  });
}

export async function list_agents(db: Database, workspace_id: string) {
  return db.query.agents.findMany({
    where: eq(agents.workspace_id, workspace_id),
    orderBy: (table, { asc }) => [asc(table.agent_name)],
  });
}

export async function get_agent(db: Database, workspace_id: string, agent_id: string) {
  return db.query.agents.findFirst({
    where: and(eq(agents.workspace_id, workspace_id), eq(agents.agent_id, agent_id)),
  });
}

export async function find_agent_by_slug(db: Database, workspace_id: string, agent_slug: string) {
  return db.query.agents.findFirst({
    where: and(eq(agents.workspace_id, workspace_id), eq(agents.agent_slug, agent_slug)),
  });
}

export async function update_agent(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    agent_name?: string;
    system_prompt?: string;
    default_model?: {
      model_provider: string;
      model_proxy: string;
      model_name: string;
    } | null;
    actor_id: string;
  },
) {
  const [agent] = await db
    .update(agents)
    .set({
      ...(input.agent_name ? { agent_name: input.agent_name } : {}),
      ...(input.system_prompt ? { system_prompt: input.system_prompt } : {}),
      ...(input.default_model === undefined
        ? {}
        : default_model_column_values(input.default_model)),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(agents.workspace_id, input.workspace_id), eq(agents.agent_id, input.agent_id)))
    .returning();

  return require_inserted_row(agent, 'Agent');
}

function default_model_column_values(
  default_model: { model_provider: string; model_proxy: string; model_name: string } | null,
) {
  if (!default_model) {
    return {
      default_model: null,
      default_model_provider: null,
      default_model_name: null,
      agent_config: sql`${agents.agent_config} - 'model_proxy'`,
    };
  }

  return {
    default_model: default_model.model_name,
    default_model_provider: default_model.model_provider,
    default_model_name: default_model.model_name,
    agent_config: sql`${agents.agent_config} || ${JSON.stringify({
      model_proxy: default_model.model_proxy,
    })}::jsonb`,
  };
}

export async function list_connections(db: DatabaseExecutor, workspace_id: string) {
  return db.query.connections.findMany({
    where: eq(connections.workspace_id, workspace_id),
    orderBy: (table, { asc }) => [asc(table.connection_name)],
  });
}

export async function create_usage_record(
  db: Database,
  input: {
    workspace_id: string;
    agent_id?: string;
    session_id?: string;
    run_id?: string;
    usage_kind: UsageRecordKind;
    quantity: string;
    unit: string;
    provider?: string;
    api_key_id?: string;
    model_proxy?: string;
    cost_cents?: number;
    cost_microcents?: number;
    usage_metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const [record] = await db
    .insert(usage_records)
    .values({
      usage_record_id: create_id(id_prefixes.usage_record),
      workspace_id: input.workspace_id,
      agent_id: input.agent_id ?? null,
      session_id: input.session_id ?? null,
      run_id: input.run_id ?? null,
      usage_date: new Date().toISOString().slice(0, 10),
      usage_kind: input.usage_kind,
      quantity: input.quantity,
      unit: input.unit,
      provider: input.provider ?? null,
      provider_name: input.provider ?? null,
      api_key_id: input.api_key_id ?? null,
      cost_cents: input.cost_cents ?? 0,
      cost_microcents: input.cost_microcents ?? 0,
      usage_metadata: {
        ...(input.usage_metadata ?? {}),
        ...(input.model_proxy ? { model_proxy: input.model_proxy } : {}),
      },
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(record, 'Usage record');
}

async function touch_session_for_messages(db: DatabaseExecutor, inputs: CreateRunMessageInput[]) {
  const last = inputs.at(-1);
  if (!last) return;
  const preview = find_latest_session_message_preview(inputs);
  await db
    .update(sessions)
    .set({
      // Evaluate after PostgreSQL acquires the session row lock so a blocked writer cannot commit
      // a timestamp sampled before the message that won the lock first.
      last_message_time: sql`clock_timestamp()`,
      ...(preview ? { last_message_preview: preview } : {}),
      last_updated_time: sql`clock_timestamp()`,
      last_updated_by: last.actor_id,
    })
    .where(eq(sessions.session_id, last.session_id));
}

function find_latest_session_message_preview(inputs: CreateRunMessageInput[]) {
  for (let index = inputs.length - 1; index >= 0; index -= 1) {
    const input = inputs[index];
    if (!input) continue;
    const preview = create_session_message_preview({
      content: input.message_content as MessageContent,
      is_user_visible: input.is_user_visible ?? true,
      message_role: input.message_role,
    });
    if (preview) return preview;
  }
  return null;
}

function create_session_message_preview(input: {
  content: MessageContent;
  is_user_visible: boolean;
  message_role: 'user' | 'assistant' | 'system' | 'tool_result' | 'event';
}) {
  if (!input.is_user_visible || !['user', 'assistant'].includes(input.message_role)) return null;

  const text = read_message_content_preview(input.content).replace(/\s+/gu, ' ').trim();
  if (!text) return null;
  return text.length <= 180 ? text : `${text.slice(0, 177)}...`;
}

function read_message_content_preview(content: MessageContent) {
  if (content.text) return content.text;
  const parts = content.parts ?? [];
  return parts
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') return `[image${part.source ? `: ${part.source}` : ''}]`;
      if (part.type === 'file') return `[file${part.name ? `: ${part.name}` : ''}]`;
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function get_message_kind(
  role: 'user' | 'assistant' | 'system' | 'tool_result' | 'event',
  message_content: MessageContent | ToolResultPointerContentData,
) {
  if (!('type' in message_content)) return 'tool_result';
  const content = message_content;
  if (content.type === 'reasoning_summary') return 'reasoning_summary';
  if (role === 'user') return 'input';
  if (role === 'assistant') return 'output';
  if (role === 'tool_result' || content.type === 'tool_result') return 'tool_result';
  if (content.type === 'event') return 'progress';
  return 'status';
}

function get_run_reason_from_trigger_type(trigger_type: RunTriggerType) {
  if (trigger_type === 'manual_retry') return 'retry';
  if (trigger_type === 'schedule' || trigger_type === 'slack_event' || trigger_type === 'app_event')
    return 'trigger';
  return trigger_type;
}
