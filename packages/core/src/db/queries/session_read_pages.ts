import type { Database } from '@coworker/core/db/connection';
import { read_execute_rows } from '@coworker/core/db/queries/read_execute_rows';
import { run_events, run_messages } from '@coworker/core/db/schema';
import type { ChatStreamEventDraft } from '@coworker/shared';
import { and, eq, gt, sql } from 'drizzle-orm';

// Paged reads for the session endpoints the browser polls. Cloud Run rejects responses
// over 32 MiB, so these reads are bounded at the database instead of loading a whole
// session and hoping it fits. The model context path does not use these: it reads the
// full history through list_session_messages on purpose.

const session_message_page_default_limit = 200;
const session_message_page_max_limit = 500;
const chat_event_page_default_limit = 500;
const chat_event_page_max_limit = 1_000;

// A row count cannot bound a response size. One tool result can serialize to tens of megabytes
// on its own, so a page of that session is too heavy to return, every load of it answers 500,
// and the session becomes permanently unopenable — bounding the row count does not
// help because the bytes are in the rows, not the count. The page stops at this budget too.
//
// Well under Cloud Run's 32 MiB so the JSON envelope and the columns this sum does not measure
// still fit. Ordinary sessions run a few MB per page and never reach it.
export const session_message_page_byte_budget = 16 * 1024 * 1024;

// Exactly the columns public_session_message sends to the browser. Selecting the rest costs a
// full detoast of every wide jsonb value on every poll and then discards it: one row can carry
// megabytes of content_json that the reducer destructures away, and a page then takes many
// seconds. Kept in step with public_session_reads.ts — a column added there
// has to be added here, which is why the list is written out rather than inferred.
const session_message_wire_columns = {
  run_message_id: true,
  session_id: true,
  run_id: true,
  message_role: true,
  message_kind: true,
  message_content: true,
  tool_call_id: true,
  is_model_visible: true,
  is_user_visible: true,
  source_type: true,
  source_metadata: true,
  message_sequence: true,
  run_message_sequence: true,
  created_time: true,
} as const;

export async function list_session_message_page(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    before_sequence?: number;
    limit?: number;
  },
) {
  const limit = session_message_page_limit(input.limit);
  const wire_columns = sql.join(
    Object.keys(session_message_wire_columns).map((column_name) => sql.identifier(column_name)),
    sql`, `,
  );
  // Three levels, each doing one thing: take the newest candidates, measure them, then keep the
  // ones that fit. The measuring window has to sit above the LIMIT — a window computed beside it
  // would run over the whole session instead of the page.
  const result = await db.execute(sql`
    SELECT ${wire_columns}, candidate_count
    FROM (
      SELECT ${wire_columns},
             SUM(OCTET_LENGTH(message_content::text)) OVER measured AS running_bytes,
             ROW_NUMBER() OVER measured AS row_position,
             COUNT(*) OVER () AS candidate_count
      FROM (
        SELECT ${wire_columns}
        FROM ${run_messages}
        WHERE ${run_messages.workspace_id} = ${input.workspace_id}
          AND ${run_messages.session_id} = ${input.session_id}
          ${
            input.before_sequence === undefined
              ? sql``
              : sql`AND ${run_messages.message_sequence} < ${input.before_sequence}`
          }
        ORDER BY ${run_messages.message_sequence} DESC
        LIMIT ${limit + 1}
      ) newest
      WINDOW measured AS (ORDER BY message_sequence DESC)
    ) candidates
    -- row_position = 1 keeps the newest message whatever it weighs: a page that returned nothing
    -- would leave the caller with no cursor to move past the row that blew the budget.
    WHERE running_bytes <= ${session_message_page_byte_budget} OR row_position = 1
    ORDER BY message_sequence DESC
  `);

  const rows = read_execute_rows<SessionMessagePageRow>(result);
  const page_rows = rows.slice(0, limit);
  const oldest_sequence = page_rows.at(-1)?.message_sequence;
  const candidate_count = Number(rows[0]?.candidate_count ?? 0);
  const has_more = candidate_count > page_rows.length;

  return {
    items: page_rows.map(({ candidate_count: _counted, ...message }) => message).reverse(),
    next_cursor: has_more && oldest_sequence !== undefined ? oldest_sequence : null,
  };
}

type SessionMessagePageRow = Pick<
  typeof run_messages.$inferSelect,
  keyof typeof session_message_wire_columns
> & { candidate_count: number | string };

export async function get_session_message(
  db: Database,
  input: { workspace_id: string; session_id: string; run_message_id: string },
) {
  return db.query.run_messages.findFirst({
    where: and(
      eq(run_messages.workspace_id, input.workspace_id),
      eq(run_messages.session_id, input.session_id),
      eq(run_messages.run_message_id, input.run_message_id),
    ),
  });
}

export async function list_run_chat_event_page(
  db: Database,
  input: {
    workspace_id: string;
    run_id: string;
    after_sequence?: number;
    limit?: number;
  },
) {
  const limit = clamp_page_limit(
    input.limit,
    chat_event_page_default_limit,
    chat_event_page_max_limit,
  );

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
      metadata: run_events.metadata,
      created_time: run_events.created_time,
    })
    .from(run_events)
    .where(
      and(
        eq(run_events.workspace_id, input.workspace_id),
        eq(run_events.run_id, input.run_id),
        eq(run_events.event_type, 'chat_event'),
        ...(input.after_sequence === undefined
          ? []
          : [gt(run_events.event_sequence, input.after_sequence)]),
      ),
    )
    .orderBy(run_events.event_sequence)
    .limit(limit);
}

export function session_message_page_limit(limit: number | undefined) {
  return clamp_page_limit(
    limit,
    session_message_page_default_limit,
    session_message_page_max_limit,
  );
}

function clamp_page_limit(value: number | undefined, default_limit: number, max_limit: number) {
  if (value === undefined || !Number.isFinite(value)) return default_limit;
  return Math.min(Math.max(Math.trunc(value), 1), max_limit);
}
