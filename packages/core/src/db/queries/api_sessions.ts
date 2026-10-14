import type { Database } from '@coworker/core/db/connection';
import { runs, sessions } from '@coworker/core/db/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

const api_session_source = 'api';

const sessions_api_marker = 'sessions_api';

type SessionsApiCursor = {
  created_time: Date;
  session_id: string;
  keep: 'older' | 'newer';
};

function created_by_api_key(api_key_id: string) {
  return and(
    eq(sessions.session_source, api_session_source),
    sql`${sessions.source_metadata} ->> 'api_key_id' = ${api_key_id}`,
    sql`${sessions.source_metadata} ->> ${sessions_api_marker} = 'true'`,
  );
}

export async function find_api_key_session(
  db: Database,
  input: { workspace_id: string; api_key_id: string; session_id: string },
) {
  return db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_id, input.session_id),
      created_by_api_key(input.api_key_id),
    ),
  });
}

export async function find_api_session_by_thread_key(
  db: Database,
  input: { workspace_id: string; external_thread_key: string },
) {
  return db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.session_source, api_session_source),
      eq(sessions.external_thread_key, input.external_thread_key),
    ),
  });
}

export async function list_api_key_sessions(
  db: Database,
  input: {
    workspace_id: string;
    api_key_id: string;
    agent_id?: string | undefined;
    scan_order: 'asc' | 'desc';
    cursor?: SessionsApiCursor | undefined;
    limit: number;
  },
) {
  return db.query.sessions.findMany({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      created_by_api_key(input.api_key_id),
      ...(input.agent_id ? [eq(sessions.agent_id, input.agent_id)] : []),
      ...(input.cursor ? [past_the_cursor(input.cursor)] : []),
    ),
    orderBy:
      input.scan_order === 'asc'
        ? [asc(sessions.created_time), asc(sessions.session_id)]
        : [desc(sessions.created_time), desc(sessions.session_id)],
    limit: input.limit,
  });
}

function past_the_cursor(cursor: SessionsApiCursor) {
  const position = sql`(${cursor.created_time.toISOString()}::timestamptz, ${cursor.session_id})`;
  const row = sql`(${sessions.created_time}, ${sessions.session_id})`;
  return cursor.keep === 'older' ? sql`${row} < ${position}` : sql`${row} > ${position}`;
}

export type SessionTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

export async function sum_session_token_usage(
  db: Database,
  input: { workspace_id: string; session_ids: string[] },
): Promise<Map<string, SessionTokenUsage>> {
  if (input.session_ids.length === 0) return new Map();
  const rows = await db
    .select({
      session_id: runs.session_id,
      input_tokens: sql<number>`coalesce(sum(${runs.input_tokens}), 0)::int`,
      output_tokens: sql<number>`coalesce(sum(${runs.output_tokens}), 0)::int`,
      cache_read_tokens: sql<number>`coalesce(sum(${runs.cache_read_tokens}), 0)::int`,
      cache_write_tokens: sql<number>`coalesce(sum(${runs.cache_write_tokens}), 0)::int`,
    })
    .from(runs)
    .where(
      and(eq(runs.workspace_id, input.workspace_id), inArray(runs.session_id, input.session_ids)),
    )
    .groupBy(runs.session_id);

  return new Map(
    rows.map((row) => [
      row.session_id,
      {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: row.cache_read_tokens,
        cache_write_tokens: row.cache_write_tokens,
      },
    ]),
  );
}
