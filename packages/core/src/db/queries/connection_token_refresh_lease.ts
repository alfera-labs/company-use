import type { Database } from '@coworker/core/db/connection';
import { connector_token_refresh_actor } from '@coworker/core/db/queries/connectors';
import { connections } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { and, eq, sql } from 'drizzle-orm';

const lease_key = 'token_refresh_lease';

/**
 * Claims the right to trade one connection's refresh token, in one short write. The lease lives on
 * the connection row, so callers in every process meet there, and the trade itself runs with no
 * connection held. Returns the row as it is now when the claim holds, or null when another caller
 * holds an unexpired lease (or the row is gone).
 */
export async function claim_connection_token_refresh(
  db: Database,
  input: { connection_id: string; lease_token: string; lease_seconds: number },
) {
  const lease_until = sql`${connections.metadata} -> ${lease_key} ->> 'until'`;
  const [row] = await db
    .update(connections)
    .set({
      metadata: sql`coalesce(${connections.metadata}, '{}'::jsonb) || jsonb_build_object(
        ${lease_key}::text,
        jsonb_build_object(
          'token', ${input.lease_token}::text,
          'until', (now() + make_interval(secs => ${input.lease_seconds}))::text
        )
      )`,
      ...updated_by(connector_token_refresh_actor),
    })
    .where(
      and(
        eq(connections.connection_id, input.connection_id),
        sql`(${lease_until} IS NULL OR (${lease_until})::timestamptz <= now())`,
      ),
    )
    .returning();
  return row ?? null;
}

export async function release_connection_token_refresh(
  db: Database,
  input: { connection_id: string; lease_token: string },
) {
  await db
    .update(connections)
    .set({
      metadata: sql`${connections.metadata} - ${lease_key}::text`,
      ...updated_by(connector_token_refresh_actor),
    })
    .where(
      and(
        eq(connections.connection_id, input.connection_id),
        sql`${connections.metadata} -> ${lease_key} ->> 'token' = ${input.lease_token}`,
      ),
    );
}
