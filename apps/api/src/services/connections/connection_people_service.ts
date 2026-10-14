import type { Database } from '@coworker/core/db/connection';
import type { AllowedUser } from '@coworker/core/db/queries/connection_access';
import {
  grant_level_for_person,
  read_people_of_connection,
} from '@coworker/core/db/queries/connection_people';
import {
  add_resource_grant,
  remove_resource_grant,
} from '@coworker/core/db/queries/resource_grant_entries';
import { workspace_member_is_active } from '@coworker/core/db/queries/workspace_membership';
import { ValidationError } from '@coworker/shared';

const connection_resource_type = 'connection';

export async function add_connection_person(
  db: Database,
  input: { workspace_id: string; connection_id: string; member: AllowedUser; actor_id: string },
): Promise<AllowedUser[]> {
  await assert_member_belongs_to_workspace(db, {
    workspace_id: input.workspace_id,
    user_id: input.member.user_id,
  });
  const people = await read_people_of_connection(db, input);
  const grant_level = grant_level_for_person(input.member);
  const named = { user_id: input.member.user_id, grant_level } as const;
  const claimer =
    people.length === 0 && input.actor_id !== input.member.user_id
      ? [{ user_id: input.actor_id, grant_level: 'manage' } as const]
      : [];

  for (const entry of [...claimer, named]) {
    await add_resource_grant(db, {
      workspace_id: input.workspace_id,
      resource_type: connection_resource_type,
      resource_id: input.connection_id,
      grantee_type: 'user',
      grantee_id: entry.user_id,
      grant_level: entry.grant_level,
      actor_id: input.actor_id,
    });
  }
  return read_people_of_connection(db, input);
}

export async function remove_connection_person(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    member_user_id: string;
    actor_id: string;
  },
): Promise<AllowedUser[]> {
  await remove_resource_grant(db, {
    workspace_id: input.workspace_id,
    resource_type: connection_resource_type,
    resource_id: input.connection_id,
    grantee_type: 'user',
    grantee_id: input.member_user_id,
  });
  return read_people_of_connection(db, input);
}

async function assert_member_belongs_to_workspace(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  if (await workspace_member_is_active(db, input)) return;
  throw new ValidationError('Only active workspace members can use a private connection.');
}

export function project_people_onto_connection_config<
  Connection extends { connection_config: Record<string, unknown> },
>(connection: Connection, people: readonly AllowedUser[]): Connection {
  return {
    ...connection,
    connection_config: {
      ...connection.connection_config,
      connection_access_type: people.length === 0 ? 'shared' : 'restricted',
      access: { allowed_users: [...people] },
    },
  };
}
