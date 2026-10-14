import type { Database } from '@coworker/core/db/connection';
import { connections } from '@coworker/core/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export const connection_setup_short_code_length = 12;

/** The first 12 characters of a setup token are 72 random bits: enough to name one pending setup. */
export function read_connection_setup_short_code(setup_token: string): string {
  return setup_token.slice(0, connection_setup_short_code_length);
}

// Scans pending setups without an index; add an expression index if that list grows large.
export async function find_pending_connection_setup_by_short_code(
  db: Database,
  short_code: string,
): Promise<{ connection_id: string; setup_token: string } | null> {
  const code = read_connection_setup_short_code(short_code);
  if (code.length < connection_setup_short_code_length) return null;

  const rows = await db
    .select({ connection_id: connections.connection_id, setup_state: connections.setup_state })
    .from(connections)
    .where(
      and(
        eq(connections.connection_status, 'pending_setup'),
        sql`left(${connections.setup_state}->>'setup_token', ${connection_setup_short_code_length}) = ${code}`,
      ),
    )
    .limit(2);
  const [match] = rows;
  const setup_token = match?.setup_state.setup_token;
  if (rows.length !== 1 || !match || !setup_token) return null;
  return { connection_id: match.connection_id, setup_token };
}
