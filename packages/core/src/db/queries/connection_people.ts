import type { Database } from '@coworker/core/db/connection';
import type { AllowedUser } from '@coworker/core/db/queries/connection_access';
import { add_resource_grant } from '@coworker/core/db/queries/resource_grant_entries';
import {
  list_grants_for_resources,
  type ResourceGrantRow,
} from '@coworker/core/db/queries/resource_grants';
import { connections } from '@coworker/core/db/schema';
import { resource_grants } from '@coworker/core/db/schema/projects';
import { and, eq, sql } from 'drizzle-orm';

const connection_resource_type = 'connection';

function read_connection_people(grants: readonly ResourceGrantRow[]): AllowedUser[] {
  return grants
    .filter((grant) => grant.grantee_type === 'user')
    .map((grant) => ({
      user_id: grant.grantee_id,
      can_edit_tools: grant.grant_level === 'manage',
      can_delete: grant.grant_level === 'manage',
    }));
}

export function grant_level_for_person(member: AllowedUser) {
  return member.can_edit_tools === true || member.can_delete === true ? 'manage' : 'use';
}

export async function list_connection_people(
  db: Database,
  input: { workspace_id: string; connection_ids: readonly string[] },
): Promise<Map<string, AllowedUser[]>> {
  const grants = await list_grants_for_resources(db, {
    workspace_id: input.workspace_id,
    resource_type: connection_resource_type,
    resource_ids: input.connection_ids,
  });
  return new Map(
    [...grants].map(([connection_id, rows]) => [connection_id, read_connection_people(rows)]),
  );
}

export async function read_people_of_connection(
  db: Database,
  input: { workspace_id: string; connection_id: string },
): Promise<AllowedUser[]> {
  const people = await list_connection_people(db, {
    workspace_id: input.workspace_id,
    connection_ids: [input.connection_id],
  });
  return people.get(input.connection_id) ?? [];
}

export async function restrict_connection_to_one_person(
  db: Database,
  input: { workspace_id: string; connection_id: string; user_id: string },
): Promise<void> {
  await add_resource_grant(db, {
    workspace_id: input.workspace_id,
    resource_type: connection_resource_type,
    resource_id: input.connection_id,
    grantee_type: 'user',
    grantee_id: input.user_id,
    grant_level: 'manage',
    actor_id: input.user_id,
  });
}

export async function open_connection_to_everyone(
  db: Database,
  input: { workspace_id: string; connection_id: string },
): Promise<void> {
  await db
    .delete(resource_grants)
    .where(
      and(
        eq(resource_grants.workspace_id, input.workspace_id),
        eq(resource_grants.resource_type, connection_resource_type),
        eq(resource_grants.resource_id, input.connection_id),
        eq(resource_grants.grantee_type, 'user'),
      ),
    );
}

export function connection_visibility_condition(acting_user_id: string) {
  return sql`(
    ${connections.connected_by} = ${acting_user_id}
    OR NOT EXISTS (
      SELECT 1 FROM ${resource_grants}
      WHERE ${resource_grants.workspace_id} = ${connections.workspace_id}
        AND ${resource_grants.resource_type} = 'connection'
        AND ${resource_grants.resource_id} = ${connections.connection_id}
        AND ${resource_grants.grantee_type} = 'user'
    )
    OR EXISTS (
      SELECT 1 FROM ${resource_grants}
      WHERE ${resource_grants.workspace_id} = ${connections.workspace_id}
        AND ${resource_grants.resource_type} = 'connection'
        AND ${resource_grants.resource_id} = ${connections.connection_id}
        AND ${resource_grants.grantee_type} = 'user'
        AND ${resource_grants.grantee_id} = ${acting_user_id}
    )
  )`;
}
