import type { Database } from '@coworker/core/db/connection';
import { connections } from '@coworker/core/db/schema';
import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';
import { and, eq, inArray, sql } from 'drizzle-orm';

export async function list_blocking_connection_resume_batches(
  db: Database,
  input: { workspace_id: string; batch_ids: string[] },
) {
  if (input.batch_ids.length === 0) return [];

  const rows = await db
    .select({
      batch_id: sql<string>`${connections.setup_state}->'resume'->>'batch_id'`,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_status, 'pending_setup'),
        inArray(sql<string>`${connections.setup_state}->'resume'->>'batch_id'`, input.batch_ids),
        sql`coalesce(${connections.setup_state}->>'resume_disposition', 'waiting') = 'waiting'`,
      ),
    );
  return [...new Set(rows.map((row) => row.batch_id))];
}

export async function postpone_pending_connection_resume(
  db: Database,
  input: { workspace_id: string; connection_id: string; actor_id: string; now?: Date },
): Promise<{ postponed: boolean; setup_state?: ConnectionSetupStateData }> {
  const now = input.now ?? new Date();
  const disposition = {
    resume_disposition: 'postponed',
    resume_disposition_time: now.toISOString(),
  } as const;
  const [connection] = await db
    .update(connections)
    .set({
      setup_state: sql`${connections.setup_state} || ${JSON.stringify(disposition)}::jsonb`,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
        eq(connections.connection_status, 'pending_setup'),
      ),
    )
    .returning({ setup_state: connections.setup_state });
  return connection
    ? { postponed: true, setup_state: connection.setup_state }
    : { postponed: false };
}
