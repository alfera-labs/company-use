import type { Database } from '@coworker/core/db/connection';
import { unchanged_lifecycle_columns } from '@coworker/core/db/schema/common';
import { run_messages, sessions } from '@coworker/core/db/schema/core';
import type { SessionMetadata } from '@coworker/core/db/schema/json_column_types';
import { and, eq, gt, sql } from 'drizzle-orm';

export function session_read_marker(metadata: SessionMetadata, reader_id: string): number {
  return metadata.read_markers?.[reader_id] ?? 0;
}

export function session_is_unread(
  metadata: SessionMetadata,
  input: { reader_id: string; newest_sequence: number },
): boolean {
  return input.newest_sequence > session_read_marker(metadata, input.reader_id);
}

// Moves one reader's marker forward, leaving every other reader's key untouched.
//
// The marker only ever moves forward. An out-of-order write — two tabs on the same chat, the
// slower one landing last — would otherwise drag it backwards and resurrect an unread mark for
// messages already seen. The guard is in the WHERE clause of the same statement that writes, so
// a concurrent update re-checks it against the row the other transaction just committed rather
// than against the copy this one read. A blocked write returns undefined, which is a success:
// the stored marker already names a later position than the one offered.
export async function set_session_read_marker(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    reader_id: string;
    last_read_sequence: number;
  },
): Promise<number | undefined> {
  const [row] = await db
    .update(sessions)
    .set({
      // Merging two objects with `||` rather than jsonb_set, because jsonb_set cannot create an
      // intermediate key: on a chat whose metadata has no `read_markers` yet it would return the
      // metadata unchanged and silently write nothing.
      session_metadata: sql`${sessions.session_metadata} || jsonb_build_object(
        'read_markers',
        COALESCE(${sessions.session_metadata} -> 'read_markers', '{}'::jsonb)
          || jsonb_build_object(${input.reader_id}::text, ${input.last_read_sequence}::int)
      )`,
      ...unchanged_lifecycle_columns(sessions),
    })
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.session_id, input.session_id),
        sql`COALESCE((${sessions.session_metadata} -> 'read_markers' ->> ${input.reader_id})::int, 0)
          < ${input.last_read_sequence}`,
      ),
    )
    .returning({ session_metadata: sessions.session_metadata });

  return row ? session_read_marker(row.session_metadata, input.reader_id) : undefined;
}

export async function list_session_newest_sequences(
  db: Database,
  workspace_id: string,
): Promise<{ session_id: string; newest_sequence: number }[]> {
  return db
    .select({
      session_id: run_messages.session_id,
      newest_sequence: sql<number>`MAX(${run_messages.message_sequence})::int`,
    })
    .from(run_messages)
    .where(eq(run_messages.workspace_id, workspace_id))
    .groupBy(run_messages.session_id);
}

export async function count_unread_messages(
  db: Database,
  input: { workspace_id: string; session_id: string; last_read_sequence: number },
): Promise<number> {
  const [row] = await db
    .select({ unread_count: sql<number>`COUNT(*)::int` })
    .from(run_messages)
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.session_id, input.session_id),
        gt(run_messages.message_sequence, input.last_read_sequence),
      ),
    );

  return row?.unread_count ?? 0;
}
