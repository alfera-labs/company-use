import { randomUUID } from 'node:crypto';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { fallback_email } from '@coworker/core/db/queries/workspace_identity';
import { users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

type TeamMemberKey = { workspace_id: string; user_id: string };

/** A person on the team page: invited until they open their first link, active after. */
export const team_member_statuses = ['active', 'invited'] as const;

export type TeamMember = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  member_role: string;
  member_status: string;
};

const team_member_columns = {
  user_id: users.user_id,
  first_name: users.first_name,
  last_name: users.last_name,
  member_role: workspace_members.member_role,
  member_status: workspace_members.member_status,
};

/** Holds the workspace row, so two changes to one team wait for each other. */
export async function lock_team(db: DatabaseExecutor, workspace_id: string): Promise<void> {
  await db.execute(
    sql`select 1 from ${workspaces} where ${workspaces.workspace_id} = ${workspace_id} for update`,
  );
}

export async function list_team_members(
  db: DatabaseExecutor,
  workspace_id: string,
): Promise<TeamMember[]> {
  return db
    .select(team_member_columns)
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(and(eq(workspace_members.workspace_id, workspace_id), member_is_on_the_team()))
    .orderBy(workspace_members.created_time);
}

export async function find_team_member(
  db: DatabaseExecutor,
  input: TeamMemberKey,
): Promise<TeamMember | null> {
  const [member] = await db
    .select(team_member_columns)
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        eq(workspace_members.user_id, input.user_id),
        member_is_on_the_team(),
      ),
    )
    .limit(1);
  return member ?? null;
}

export async function count_active_team_owners(
  db: DatabaseExecutor,
  workspace_id: string,
): Promise<number> {
  const owners = await db
    .select({ user_id: workspace_members.user_id })
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_role, 'owner'),
        eq(workspace_members.member_status, 'active'),
      ),
    );
  return owners.length;
}

/**
 * A new person and their seat, not active until they open their first sign-in link. A person
 * on a team link has no address, and the email column is unique and required, so it gets a
 * stand-in of the same shape provisioning gives a provider user without one.
 */
export async function create_invited_team_member(
  db: DatabaseExecutor,
  input: { workspace_id: string; first_name: string; member_role: string; actor_id: string },
): Promise<TeamMember> {
  const [user] = await db
    .insert(users)
    .values({
      email: fallback_email({ provider_key: 'team', provider_user_id: randomUUID() }),
      first_name: input.first_name,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning({ user_id: users.user_id });
  const { user_id } = require_inserted_row(user, 'Invited person');

  await db.insert(workspace_members).values({
    workspace_member_id: create_id(id_prefixes.workspace_member),
    workspace_id: input.workspace_id,
    user_id,
    member_role: input.member_role,
    member_status: 'invited',
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  });
  return {
    user_id,
    first_name: input.first_name,
    last_name: null,
    member_role: input.member_role,
    member_status: 'invited',
  };
}

/** True when this call made an invited person active, so the caller opens their first project once. */
export async function activate_invited_team_member(
  db: DatabaseExecutor,
  input: TeamMemberKey,
): Promise<boolean> {
  const activated = await db
    .update(workspace_members)
    .set({ member_status: 'active', ...updated_by(input.user_id) })
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        eq(workspace_members.user_id, input.user_id),
        eq(workspace_members.member_status, 'invited'),
      ),
    )
    .returning({ user_id: workspace_members.user_id });
  return activated.length > 0;
}

export async function set_team_member_role(
  db: DatabaseExecutor,
  input: TeamMemberKey & { member_role: string; actor_id: string },
): Promise<void> {
  await db
    .update(workspace_members)
    .set({ member_role: input.member_role, ...updated_by(input.actor_id) })
    .where(member_seat(input));
}

/** The one name a person shows to the team and to the coworker, so no family name is kept. */
export async function set_team_member_name(
  db: DatabaseExecutor,
  input: { user_id: string; name: string },
): Promise<void> {
  await db
    .update(users)
    .set({ first_name: input.name, last_name: null, ...updated_by(input.user_id) })
    .where(eq(users.user_id, input.user_id));
}

export async function deactivate_team_member(
  db: DatabaseExecutor,
  input: TeamMemberKey & { actor_id: string },
): Promise<void> {
  await db
    .update(workspace_members)
    .set({ member_status: 'inactive', ...updated_by(input.actor_id) })
    .where(member_seat(input));
}

function member_seat(input: TeamMemberKey) {
  return and(
    eq(workspace_members.workspace_id, input.workspace_id),
    eq(workspace_members.user_id, input.user_id),
    member_is_on_the_team(),
  );
}

function member_is_on_the_team() {
  return inArray(workspace_members.member_status, [...team_member_statuses]);
}
