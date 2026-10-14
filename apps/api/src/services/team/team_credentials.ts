import type { Database } from '@coworker/core';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { connections } from '@coworker/core/db/schema';
import { is_workspace_administrator_role } from '@coworker/shared';
import { and, eq, inArray, or } from 'drizzle-orm';

type Person = { workspace_id: string; user_id: string };

/**
 * The stored credentials a person manages in team mode: every one for an owner or an admin,
 * and for a member the ones they made or connected. A stored credential is a secret one
 * person typed, so another member does not list it, renew it or switch it off.
 */
export async function keep_credentials_person_manages<Credential extends { connection_id: string }>(
  db: Database,
  person: Person,
  credentials: Credential[],
): Promise<Credential[]> {
  const role = await find_active_workspace_member_role(db, person);
  if (is_workspace_administrator_role(role)) return credentials;
  if (!role || credentials.length === 0) return [];
  const own = await db
    .select({ connection_id: connections.connection_id })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, person.workspace_id),
        inArray(
          connections.connection_id,
          credentials.map((credential) => credential.connection_id),
        ),
        or(
          eq(connections.connected_by, person.user_id),
          eq(connections.created_by, person.user_id),
        ),
      ),
    );
  const own_ids = new Set(own.map((connection) => connection.connection_id));
  return credentials.filter((credential) => own_ids.has(credential.connection_id));
}
