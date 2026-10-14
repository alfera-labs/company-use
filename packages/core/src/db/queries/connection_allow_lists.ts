import type { Database } from '@coworker/core/db/connection';
import {
  type AllowedUser,
  read_connection_access,
} from '@coworker/core/db/queries/connection_access';
import { add_resource_grant } from '@coworker/core/db/queries/resource_grant_entries';
import { connections } from '@coworker/core/db/schema';
import { and, eq, sql } from 'drizzle-orm';

type ConnectionAllowList = {
  workspace_id: string;
  connection_id: string;
  connection_name: string | null;
  allowed_users: AllowedUser[];
};

async function list_connections_with_an_allow_list(db: Database): Promise<ConnectionAllowList[]> {
  const rows = await db
    .select({
      workspace_id: connections.workspace_id,
      connection_id: connections.connection_id,
      connection_name: connections.connection_name,
      connection_config: connections.connection_config,
    })
    .from(connections)
    .where(
      and(
        eq(connections.connection_status, 'active'),
        sql`${connections.connection_config}->>'connection_access_type' = 'restricted'`,
      ),
    );

  return rows.flatMap((row) => {
    const { allowed_users } = read_connection_access(row.connection_config);
    if (allowed_users.length === 0) return [];
    return [
      {
        workspace_id: row.workspace_id,
        connection_id: row.connection_id,
        connection_name: row.connection_name,
        allowed_users,
      },
    ];
  });
}

export type AllowListMove = {
  connection_id: string;
  connection_name: string | null;
  grants: number;
};

const backfill_actor_id = 'system:backfill_connection_sharing';

export async function move_connection_allow_lists_to_grants(
  db: Database,
  input: { write: boolean },
): Promise<AllowListMove[]> {
  const connections_to_move = await list_connections_with_an_allow_list(db);
  const moves: AllowListMove[] = [];

  for (const connection of connections_to_move) {
    if (input.write) {
      for (const person of connection.allowed_users) {
        await add_resource_grant(db, {
          workspace_id: connection.workspace_id,
          resource_type: 'connection',
          resource_id: connection.connection_id,
          grantee_type: 'user',
          grantee_id: person.user_id,
          grant_level: person.can_edit_tools || person.can_delete ? 'manage' : 'use',
          actor_id: backfill_actor_id,
        });
      }
    }
    moves.push({
      connection_id: connection.connection_id,
      connection_name: connection.connection_name,
      grants: connection.allowed_users.length,
    });
  }
  return moves;
}
