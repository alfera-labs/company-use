import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { read_connection_permissions } from '@coworker/core/db/queries/connection_access';
import { read_people_of_connection } from '@coworker/core/db/queries/connection_people';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { connections } from '@coworker/core/db/schema';
import { built_in_connection_status } from '@coworker/core/integrations/alfera_api_tools';
import { AppError, NotFoundError } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

export type UserConnectionAction = {
  workspace_id: string;
  connection_id: string;
  acting_user_id: string;
  actor_id: string;
};
export type ConnectionRow = typeof connections.$inferSelect;
export function run_user_connection_action<Result>(
  db: Database,
  input: UserConnectionAction,
  action: (transaction: Database, connection: ConnectionRow) => Promise<Result>,
) {
  return db.transaction(async (transaction_db) => {
    const connection = await lock_connection_for_user_action(transaction_db, input);
    assert_connection_is_not_built_in(connection);
    return action(transaction_db, connection);
  });
}
function assert_connection_is_not_built_in(connection: ConnectionRow) {
  if (connection.connection_status !== built_in_connection_status) return;
  throw new AppError(
    'connection_is_built_in',
    `${connection.connection_name ?? 'This connection'} is built into the workspace: it cannot be disconnected, reconnected, renamed, or shared. To stop a tool, set it to Never allow.`,
    409,
  );
}
async function lock_connection_for_user_action(db: DatabaseExecutor, input: UserConnectionAction) {
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
      ),
    )
    .limit(1)
    .for('update');
  if (!connection) throw new NotFoundError('Connection');
  return connection;
}
async function assert_connection_permission(
  db: Database,
  connection: Pick<ConnectionRow, 'connection_id' | 'connected_by' | 'connection_status'>,
  input: Pick<UserConnectionAction, 'workspace_id' | 'acting_user_id'>,
  permission: 'can_delete' | 'can_manage',
  action: 'delete' | 'manage',
) {
  const [member_role, allowed_users] = await Promise.all([
    find_active_workspace_member_role(db, {
      workspace_id: input.workspace_id,
      user_id: input.acting_user_id,
    }),
    read_people_of_connection(db, {
      workspace_id: input.workspace_id,
      connection_id: connection.connection_id,
    }),
  ]);
  const permissions = read_connection_permissions({
    allowed_users,
    connected_by: connection.connected_by,
    acting_user_id: input.acting_user_id,
    member_role,
    connection_status: connection.connection_status,
  });
  if (permissions[permission]) return;
  throw new AppError(
    'connection_access_denied',
    `You are not allowed to ${action} this connection. Ask a member who manages it.`,
    403,
  );
}
export function assert_connection_manager(
  db: Database,
  connection: Pick<ConnectionRow, 'connection_id' | 'connected_by' | 'connection_status'>,
  input: Pick<UserConnectionAction, 'workspace_id' | 'acting_user_id'>,
) {
  return assert_connection_permission(db, connection, input, 'can_manage', 'manage');
}
export function assert_connection_deleter(
  db: Database,
  connection: Pick<ConnectionRow, 'connection_id' | 'connected_by' | 'connection_status'>,
  input: Pick<UserConnectionAction, 'workspace_id' | 'acting_user_id'>,
) {
  return assert_connection_permission(db, connection, input, 'can_delete', 'delete');
}
