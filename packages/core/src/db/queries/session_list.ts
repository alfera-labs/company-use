import type { Database } from '@coworker/core/db/connection';
import { visible_to_reader } from '@coworker/core/db/queries/session_visibility';
import { run_messages, runs, sessions } from '@coworker/core/db/schema';
import type { SessionMetadata } from '@coworker/core/db/schema/json_column_types';
import { agent_heartbeat_session_kind } from '@coworker/shared';
import { and, desc, eq, getTableColumns, ne, not, sql } from 'drizzle-orm';

export type ListedSessionsFilter = {
  project_id?: string;
  visible_to_user_id: string | null;
  hide_system_trigger_sessions?: boolean;
};

type LatestRun = {
  run_id: string;
  run_status: string;
  finished_time: Date | null;
  created_time: Date;
};

export function listed_sessions_filter(workspace_id: string, filter: ListedSessionsFilter) {
  return and(
    eq(sessions.workspace_id, workspace_id),
    ...(filter.project_id ? [eq(sessions.project_id, filter.project_id)] : []),
    ...(filter.hide_system_trigger_sessions ? [not(is_system_trigger_session(workspace_id))] : []),
    ...(filter.visible_to_user_id === null
      ? []
      : [visible_to_reader(workspace_id, filter.visible_to_user_id)]),
    ne(sessions.session_status, 'deleted'),
    sql`coalesce(${sessions.source_metadata} ->> 'kind', '') <> ${agent_heartbeat_session_kind}`,
  );
}

function is_system_trigger_session(workspace_id: string) {
  return sql`(
    ${sessions.session_source} = 'trigger'
    AND (
      ${sessions.source_metadata} @> '{"runtime_response_is_user_visible": false}'::jsonb
      OR EXISTS (
        SELECT 1 FROM "triggers" AS system_trigger
        WHERE system_trigger."workspace_id" = ${workspace_id}
          AND system_trigger."trigger_id" = ${sessions.source_metadata} ->> 'trigger_id'
          AND system_trigger."trigger_source" ->> 'kind' = 'system'
      )
    )
  )`;
}

const outer_sessions = sql`${sessions}`;

export async function list_sessions_with_latest_activity(
  db: Database,
  workspace_id: string,
  filter: ListedSessionsFilter,
) {
  const rows = await db
    .select({
      ...getTableColumns(sessions),
      session_metadata: sql<SessionMetadata>`${sessions.session_metadata} - 'title_generation'`,
      newest_sequence: sql<number>`coalesce((
        select max(${run_messages.message_sequence}) from ${run_messages}
        where ${run_messages.workspace_id} = ${outer_sessions}.workspace_id
          and ${run_messages.session_id} = ${outer_sessions}.session_id), 0)::int`,
      latest_run: sql<Record<string, string | null> | null>`(
        select jsonb_build_object('run_id', latest.run_id, 'run_status', latest.run_status,
          'finished_time', latest.finished_time, 'created_time', latest.created_time)
        from ${runs} latest
        where latest.workspace_id = ${outer_sessions}.workspace_id
          and latest.session_id = ${outer_sessions}.session_id and latest.parent_run_id is null
        order by latest.created_time desc, latest.run_id desc limit 1)`,
    })
    .from(sessions)
    .where(listed_sessions_filter(workspace_id, filter))
    .orderBy(desc(sessions.last_updated_time));
  return rows.map(({ latest_run, ...session }) => ({
    ...session,
    latest_run: latest_run ? read_latest_run(latest_run) : null,
  }));
}

function read_latest_run(json: Record<string, string | null>): LatestRun {
  return {
    run_id: String(json.run_id),
    run_status: String(json.run_status),
    finished_time: json.finished_time ? new Date(json.finished_time) : null,
    created_time: new Date(String(json.created_time)),
  };
}
