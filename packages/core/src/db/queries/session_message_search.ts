import type { Database } from '@coworker/core/db/connection';
import { read_execute_rows } from '@coworker/core/db/queries/read_execute_rows';
import { session_is_visible_to_reader } from '@coworker/core/db/queries/session_participant_visibility';
import { session_ran_for_automation } from '@coworker/core/db/queries/visible_sessions';
import { agent_heartbeat_session_kind } from '@coworker/shared';
import { sql } from 'drizzle-orm';

const session_message_search_default_limit = 20;
export const session_message_search_max_limit = 50;

// The text window the index is built over. Must stay identical to the expression in
// 0049_session_message_search.sql — a different bound is a different expression, and the planner
// silently stops using the index rather than failing.
const searchable_content_char_cap = 200_000;

const ranked_candidate_cap = 500;

// ts_headline normally returns HTML, and the text it marks up was written by users and models.
// Rendering that in a browser means trusting it. These two control characters delimit a match
// instead: they cannot occur in prose, they survive JSON transport, and the API splits on them
// to build real elements. Nothing that could be markup ever reaches the client.
export const match_start_marker = '\u0002';
export const match_end_marker = '\u0003';

const headline_options = [
  `StartSel=${match_start_marker}`,
  `StopSel=${match_end_marker}`,
  'MaxFragments=1',
  'MaxWords=18',
  'MinWords=6',
  'HighlightAll=FALSE',
].join(', ');

export type SessionMessageMatchRow = {
  session_id: string;
  session_title: string | null;
  session_source: string;
  matched_message_sequence: number;
  last_message_time: Date | string | null;
  snippet: string;
};

function is_searchable_query_text(query_text: string) {
  return query_text.trim().length > 0;
}

export type SessionMessageSearchFilter = {
  conversation_text_only?: boolean;
  session_id?: string;
  session_source?: string;
  since?: Date;
  automation_id?: string;
};

export async function search_session_messages(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    query_text: string;
    limit?: number;
  } & SessionMessageSearchFilter,
): Promise<SessionMessageMatchRow[]> {
  if (!is_searchable_query_text(input.query_text)) return [];

  const limit = clamp_search_limit(input.limit);
  const search_query = sql`websearch_to_tsquery('english', ${input.query_text})`;
  const message_vector = sql`to_tsvector('english', left(run_messages.content_text, ${searchable_content_char_cap}))`;

  // Four stages, each doing one thing: rank the matching messages, keep the best one per chat,
  // take the top chats, and only then cut the snippets. The snippet has to be built last —
  // ts_headline re-parses the whole document per row, so computing it before the LIMIT would run
  // it hundreds of times to display a handful.
  const result = await db.execute(sql`
    WITH ranked_messages AS (
      SELECT
        run_messages.session_id AS session_id,
        run_messages.message_sequence AS message_sequence,
        run_messages.content_text AS content_text,
        ts_rank_cd(${message_vector}, ${search_query}) AS match_rank
      FROM run_messages
      JOIN sessions ON sessions.session_id = run_messages.session_id
      WHERE run_messages.workspace_id = ${input.workspace_id}
        AND run_messages.is_user_visible
        AND run_messages.content_text IS NOT NULL
        AND ${message_vector} @@ ${search_query}
        -- A deleted chat keeps its rows because runs and billing still reference them. It stops
        -- being findable here for the same reason it leaves the sidebar.
        AND sessions.session_status <> 'deleted'
        AND coalesce(sessions.source_metadata ->> 'kind', '') <> ${agent_heartbeat_session_kind}
        AND ${session_is_visible_to_reader(input.workspace_id, input.user_id)}
        ${chosen_search_filters(input)}
      ORDER BY match_rank DESC
      LIMIT ${ranked_candidate_cap}
    ),
    best_message_per_session AS (
      SELECT DISTINCT ON (session_id)
        session_id, message_sequence, content_text, match_rank
      FROM ranked_messages
      -- Five hits inside one chat is one result showing its strongest line, not five rows that
      -- push every other chat off the list.
      ORDER BY session_id, match_rank DESC, message_sequence DESC
    ),
    top_sessions AS (
      SELECT
        best_message_per_session.session_id AS session_id,
        best_message_per_session.message_sequence AS matched_message_sequence,
        best_message_per_session.content_text AS content_text,
        best_message_per_session.match_rank AS match_rank,
        sessions.session_title AS session_title,
        sessions.session_source AS session_source,
        sessions.last_message_time AS last_message_time
      FROM best_message_per_session
      JOIN sessions ON sessions.session_id = best_message_per_session.session_id
      ORDER BY match_rank DESC, sessions.last_message_time DESC NULLS LAST
      LIMIT ${limit}
    )
    SELECT
      session_id,
      session_title,
      session_source,
      matched_message_sequence,
      last_message_time,
      ts_headline(
        'english',
        left(content_text, ${searchable_content_char_cap}),
        ${search_query},
        ${headline_options}
      ) AS snippet
    FROM top_sessions
    -- Repeated because a CTE does not promise to hand its rows on in order.
    ORDER BY match_rank DESC, last_message_time DESC NULLS LAST
  `);

  return read_execute_rows<SessionMessageMatchRow>(result);
}

function chosen_search_filters(filter: SessionMessageSearchFilter) {
  return sql.join(
    [
      filter.conversation_text_only
        ? sql`AND run_messages.message_kind IN ('input', 'output')`
        : sql``,
      filter.session_id ? sql`AND run_messages.session_id = ${filter.session_id}` : sql``,
      filter.session_source ? sql`AND sessions.session_source = ${filter.session_source}` : sql``,
      filter.since
        ? sql`AND run_messages.created_time >= ${filter.since.toISOString()}::timestamptz`
        : sql``,
      filter.automation_id ? sql`AND ${session_ran_for_automation(filter.automation_id)}` : sql``,
    ],
    sql` `,
  );
}

function clamp_search_limit(value: number | undefined) {
  if (value === undefined) return session_message_search_default_limit;
  return Math.max(1, Math.min(value, session_message_search_max_limit));
}
