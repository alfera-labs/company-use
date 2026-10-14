import type { Database } from '@coworker/core/db/connection';
import { read_execute_rows } from '@coworker/core/db/queries/read_execute_rows';
import { run_events } from '@coworker/core/db/schema';
import { merge_metadata } from '@coworker/core/db/schema/common';
import { and, eq, sql } from 'drizzle-orm';

export type InlineRunEventCandidate = {
  run_event_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  event_data: unknown;
  event_metadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export async function list_large_inline_run_events(
  db: Database,
  input: { after_run_event_id: string; min_bytes: number; payload_shape: string; limit: number },
): Promise<InlineRunEventCandidate[]> {
  const rows = await db.execute(sql`
    SELECT run_event_id, workspace_id, session_id, run_id, event_data, event_metadata, metadata
    FROM ${run_events}
    WHERE run_event_id > ${input.after_run_event_id}
      AND octet_length(event_data::text) + octet_length(event_metadata::text) > ${input.min_bytes}
      AND (metadata->>'payload_shape') IS DISTINCT FROM ${input.payload_shape}
    ORDER BY run_event_id
    LIMIT ${input.limit}
  `);
  return read_execute_rows<InlineRunEventCandidate>(rows);
}

export async function set_run_event_payload(
  db: Database,
  input: {
    run_event_id: string;
    event_data: unknown;
    event_metadata: Record<string, unknown>;
    metadata: Record<string, unknown>;
    payload_shape: string;
    actor_id: string;
  },
) {
  const updated = await db
    .update(run_events)
    .set({
      event_data: input.event_data,
      event_metadata: merge_metadata(run_events.event_metadata, input.event_metadata),
      metadata: merge_metadata(run_events.metadata, input.metadata),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(run_events.run_event_id, input.run_event_id),
        sql`(${run_events.metadata}->>'payload_shape') IS DISTINCT FROM ${input.payload_shape}`,
      ),
    )
    .returning({ run_event_id: run_events.run_event_id });
  return updated.length;
}
