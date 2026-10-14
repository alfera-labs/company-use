import { project_people_onto_connection_config } from '@api/services/connections/connection_people_service';
import { say_when_connection_cannot_work } from '@api/services/connections/connection_that_cannot_work';
import type { Database } from '@coworker/core';
import { read_connection_permissions } from '@coworker/core/db/queries/connection_access';
import { get_redacted_connection } from '@coworker/core/db/queries/connection_management';
import { read_people_of_connection } from '@coworker/core/db/queries/connection_people';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { is_workspace_administrator_role, NotFoundError } from '@coworker/shared';

export async function get_connection_for_user(
  db: Database,
  input: { workspace_id: string; connection_id: string; acting_user_id: string },
) {
  const member_role = await find_active_workspace_member_role(db, {
    workspace_id: input.workspace_id,
    user_id: input.acting_user_id,
  });
  const [connection, allowed_users] = await Promise.all([
    get_redacted_connection(db, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      ...connections_a_person_sees(input.acting_user_id, member_role),
    }),
    read_people_of_connection(db, input),
  ]);
  if (!connection) throw new NotFoundError('Connection');
  return {
    ...project_people_onto_connection_config(connection, allowed_users),
    ...say_when_connection_cannot_work(connection),
    permissions: read_connection_permissions({
      allowed_users,
      connected_by: connection.connected_by,
      acting_user_id: input.acting_user_id,
      member_role,
      connection_status: connection.connection_status,
    }),
  };
}

/**
 * A workspace admin sees every connection, so one shared with other people is never lost to the
 * people who must manage it. Seeing is not using: a run asks may_use_resource for that.
 */
export function connections_a_person_sees(acting_user_id: string, member_role: string | null) {
  return is_workspace_administrator_role(member_role) ? {} : { acting_user_id };
}
