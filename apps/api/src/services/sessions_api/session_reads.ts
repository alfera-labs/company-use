import {
  type PublicSession,
  public_session,
  public_session_usage,
} from '@api/services/sessions_api/public_session';
import { read_last_agent_message } from '@api/services/sessions_api/session_event_reads';
import {
  encode_page_cursor,
  type PageCursor,
  type SessionPageOrder,
} from '@api/services/sessions_api/session_page_cursor';
import type { sessions } from '@coworker/core';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import {
  find_api_key_session,
  list_api_key_sessions,
  sum_session_token_usage,
} from '@coworker/core/db/queries/api_sessions';
import { list_sessions_waiting_on_approval } from '@coworker/core/db/queries/event_waits';
import { find_agent_by_slug, get_agent } from '@coworker/core/db/queries/sessions';
import { list_queues_with_queued_event_jobs } from '@coworker/jobs';
import { NotFoundError, session_queue_key } from '@coworker/shared';

type SessionRow = typeof sessions.$inferSelect;

export type SessionPage = {
  data: PublicSession[];
  next_page: string | null;
  prev_page: string | null;
};

export type ListSessionsRequest = {
  limit: number;
  order: SessionPageOrder;
  agent_slug?: string | undefined;
  cursor?: PageCursor | undefined;
};

export type SessionSnapshot = PublicSession & { last_agent_message: string | null };

export async function get_api_session(
  db: Database,
  api_key: ApiKey,
  session_id: string,
): Promise<PublicSession> {
  const session = await require_owned_api_session(db, api_key, session_id);
  const [projected] = await project_sessions(db, api_key.workspace_id, [session]);
  if (!projected) throw new NotFoundError('Session');
  return projected;
}

export async function get_api_session_snapshot(
  db: Database,
  api_key: ApiKey,
  session_id: string,
): Promise<SessionSnapshot> {
  const session = await require_owned_api_session(db, api_key, session_id);
  const [projected, last_agent_message] = await Promise.all([
    project_sessions(db, api_key.workspace_id, [session]).then((sessions) => sessions.at(0)),
    read_last_agent_message(db, api_key.workspace_id, session),
  ]);
  if (!projected) throw new NotFoundError('Session');
  return { ...projected, last_agent_message };
}

export async function require_owned_api_session(
  db: Database,
  api_key: ApiKey,
  session_id: string,
): Promise<SessionRow> {
  const session = await find_api_key_session(db, {
    workspace_id: api_key.workspace_id,
    api_key_id: api_key.api_key_id,
    session_id,
  });
  if (!session) throw new NotFoundError('Session');
  return session;
}

export async function list_api_sessions(
  db: Database,
  api_key: ApiKey,
  request: ListSessionsRequest,
): Promise<SessionPage> {
  const agent = request.agent_slug
    ? await find_agent_by_slug(db, api_key.workspace_id, request.agent_slug)
    : null;
  if (request.agent_slug && !agent) return { data: [], next_page: null, prev_page: null };

  const reading_backwards = request.cursor?.direction === 'prev';
  const scan_order = reading_backwards ? flipped(request.order) : request.order;
  const rows = await list_api_key_sessions(db, {
    workspace_id: api_key.workspace_id,
    api_key_id: api_key.api_key_id,
    agent_id: agent?.agent_id,
    scan_order,
    ...(request.cursor
      ? {
          cursor: {
            created_time: request.cursor.created_time,
            session_id: request.cursor.session_id,
            keep: scan_order === 'desc' ? ('older' as const) : ('newer' as const),
          },
        }
      : {}),
    limit: request.limit + 1,
  });

  const has_more = rows.length > request.limit;
  const page_rows = rows.slice(0, request.limit);
  if (reading_backwards) page_rows.reverse();

  return {
    data: await project_sessions(db, api_key.workspace_id, page_rows),
    ...page_links({
      rows: page_rows,
      order: request.order,
      reading_backwards,
      has_more,
      came_from_a_cursor: Boolean(request.cursor),
    }),
  };
}

function page_links(input: {
  rows: SessionRow[];
  order: SessionPageOrder;
  reading_backwards: boolean;
  has_more: boolean;
  came_from_a_cursor: boolean;
}) {
  const first = input.rows.at(0);
  const last = input.rows.at(-1);
  if (!first || !last) return { next_page: null, prev_page: null };

  const link = (row: SessionRow, direction: 'next' | 'prev') =>
    encode_page_cursor({
      created_time: row.created_time,
      session_id: row.session_id,
      order: input.order,
      direction,
    });

  const has_next = input.reading_backwards ? true : input.has_more;
  const has_previous = input.reading_backwards ? input.has_more : input.came_from_a_cursor;
  return {
    next_page: has_next ? link(last, 'next') : null,
    prev_page: has_previous ? link(first, 'prev') : null,
  };
}

export async function project_sessions(
  db: Database,
  workspace_id: string,
  rows: SessionRow[],
): Promise<PublicSession[]> {
  if (rows.length === 0) return [];
  const [usage_by_session, busy_queues, waiting_sessions, agents_by_id] = await Promise.all([
    sum_session_token_usage(db, {
      workspace_id,
      session_ids: rows.map((row) => row.session_id),
    }),
    list_queues_with_queued_event_jobs(db, {
      workspace_id,
      queue_keys: rows.map((row) => session_queue_key(row.session_id)),
    }),
    list_sessions_waiting_on_approval(db, {
      workspace_id,
      session_ids: rows.map((row) => row.session_id),
    }),
    read_agents(db, workspace_id, rows),
  ]);

  return rows.map((session) =>
    public_session({
      session,
      agent: agents_by_id.get(session.agent_id),
      usage: public_session_usage(usage_by_session.get(session.session_id)),
      has_pending_job: busy_queues.has(session_queue_key(session.session_id)),
      is_waiting_on_approval: waiting_sessions.has(session.session_id),
    }),
  );
}

async function read_agents(db: Database, workspace_id: string, rows: SessionRow[]) {
  const agent_ids = [...new Set(rows.map((row) => row.agent_id))];
  const agents = await Promise.all(
    agent_ids.map((agent_id) => get_agent(db, workspace_id, agent_id)),
  );
  return new Map(agents.filter((agent) => agent != null).map((agent) => [agent.agent_id, agent]));
}

function flipped(order: SessionPageOrder): SessionPageOrder {
  return order === 'desc' ? 'asc' : 'desc';
}
