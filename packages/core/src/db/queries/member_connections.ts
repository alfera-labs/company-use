import type { Database } from '@coworker/core/db/connection';
import { list_connection_people } from '@coworker/core/db/queries/connection_people';
import { connections } from '@coworker/core/db/schema';
import { and, eq, ne } from 'drizzle-orm';

export type MemberConnection = {
  connection_id: string;
  connection_name: string;
  also_used_by_user_ids: string[];
};

/**
 * The app accounts a person connected that are still live, and who else was given each one.
 * They are that person's own accounts, wired into the workspace.
 */
export async function list_live_connections_made_by(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<MemberConnection[]> {
  const made = await db
    .select({
      connection_id: connections.connection_id,
      connection_name: connections.connection_name,
      external_account_name: connections.external_account_name,
      app_id: connections.app_id,
    })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connected_by, input.user_id),
        ne(connections.connection_status, 'revoked'),
      ),
    );
  const people = await list_connection_people(db, {
    workspace_id: input.workspace_id,
    connection_ids: made.map((connection) => connection.connection_id),
  });
  return made.map((connection) => ({
    connection_id: connection.connection_id,
    connection_name:
      connection.connection_name ?? connection.external_account_name ?? connection.app_id,
    also_used_by_user_ids: (people.get(connection.connection_id) ?? [])
      .map((person) => person.user_id)
      .filter((user_id) => user_id !== input.user_id),
  }));
}
