import type { Database } from '@coworker/core/db/connection';
import { session_is_visible_to_reader } from '@coworker/core/db/queries/session_participant_visibility';
import { active_run_statuses } from '@coworker/core/db/queries/sessions';
import { automations, runs, sessions } from '@coworker/core/db/schema';
import { agent_heartbeat_session_kind } from '@coworker/shared';
import { and, desc, eq, gte, inArray, ne, type SQL, sql } from 'drizzle-orm';

const session_index_max_limit = 100;
const active_run_index_max_limit = 100;

export type VisibleSessionRow = {
  session_id: string;
  session_title: string | null;
  session_source: string;
  project_id: string | null;
  last_message_time: Date | null;
  last_updated_time: Date;
  active_run_id: string | null;
};

export type SessionIndexFilter = {
  workspace_id: string;
  reader_user_id: string;
  session_source?: string;
  since?: Date;
  automation_id?: string;
  limit: number;
};

export async function list_visible_sessions(
  db: Database,
  filter: SessionIndexFilter,
): Promise<VisibleSessionRow[]> {
  return db
    .select({
      session_id: sessions.session_id,
      session_title: sessions.session_title,
      session_source: sessions.session_source,
      project_id: sessions.project_id,
      last_message_time: sessions.last_message_time,
      last_updated_time: sessions.last_updated_time,
      active_run_id: sessions.active_run_id,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.workspace_id, filter.workspace_id),
        session_is_listable(),
        session_is_visible_to_reader(filter.workspace_id, filter.reader_user_id),
        ...(filter.session_source ? [eq(sessions.session_source, filter.session_source)] : []),
        ...(filter.since ? [gte(sessions.last_updated_time, filter.since)] : []),
        ...(filter.automation_id ? [session_ran_for_automation(filter.automation_id)] : []),
      ),
    )
    .orderBy(desc(sessions.last_updated_time))
    .limit(clamp_index_limit(filter.limit, session_index_max_limit));
}

export async function find_visible_session(
  db: Database,
  input: { workspace_id: string; session_id: string; reader_user_id: string },
) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.session_id, input.session_id),
        session_is_listable(),
        session_is_visible_to_reader(input.workspace_id, input.reader_user_id),
      ),
    )
    .limit(1);
  return session ?? null;
}

export type VisibleActiveRunRow = {
  run_id: string;
  session_id: string;
  run_status: string;
  run_reason: string;
  automation_id: string | null;
  automation_name: string | null;
  session_title: string | null;
  session_source: string;
  started_time: Date | null;
  created_time: Date;
};

export async function list_visible_active_runs(
  db: Database,
  input: { workspace_id: string; reader_user_id: string; limit: number },
): Promise<VisibleActiveRunRow[]> {
  return db
    .select({
      run_id: runs.run_id,
      session_id: runs.session_id,
      run_status: runs.run_status,
      run_reason: runs.run_reason,
      automation_id: runs.automation_id,
      automation_name: automations.automation_name,
      session_title: sessions.session_title,
      session_source: sessions.session_source,
      started_time: runs.started_time,
      created_time: runs.created_time,
    })
    .from(runs)
    .innerJoin(
      sessions,
      and(eq(sessions.workspace_id, runs.workspace_id), eq(sessions.session_id, runs.session_id)),
    )
    .leftJoin(
      automations,
      and(
        eq(automations.workspace_id, runs.workspace_id),
        eq(automations.automation_id, runs.automation_id),
      ),
    )
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        inArray(runs.run_status, active_run_statuses),
        session_is_listable(),
        session_is_visible_to_reader(input.workspace_id, input.reader_user_id),
      ),
    )
    .orderBy(desc(runs.created_time))
    .limit(clamp_index_limit(input.limit, active_run_index_max_limit));
}

export function session_ran_for_automation(automation_id: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM "runs" AS automation_run
    WHERE automation_run."session_id" = ${sessions.session_id}
      AND automation_run."automation_id" = ${automation_id}
  )`;
}

function session_is_listable(): SQL {
  return and(
    ne(sessions.session_status, 'deleted'),
    sql`coalesce(${sessions.source_metadata} ->> 'kind', '') <> ${agent_heartbeat_session_kind}`,
  ) as SQL;
}

function clamp_index_limit(value: number, maximum: number) {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(Math.max(Math.trunc(value), 1), maximum);
}
