import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import { users, workspace_members } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import { ConflictError } from '@coworker/shared';
import { and, eq, inArray, isNotNull, ne, type SQL, sql } from 'drizzle-orm';

const match_email_key = 'team_match_email';

/**
 * A person of a team-mode install signs in with a link and has no address of their own there:
 * the email column holds a stand-in. This is the one address the person gave so that Slack and
 * mail can tell it is them. It is used to match a Slack speaker or a mail sender to the
 * member, and for nothing else: no mail is sent to it and nobody signs in with it.
 */
export const team_match_email_of_user: SQL<string | null> =
  sql`${users.user_data} ->> 'team_match_email'`;

export async function read_team_match_email(
  db: DatabaseExecutor,
  user_id: string,
): Promise<string | null> {
  const [user] = await db
    .select({ match_email: team_match_email_of_user })
    .from(users)
    .where(eq(users.user_id, user_id))
    .limit(1);
  return user?.match_email ?? null;
}

/**
 * Sets or clears the address of a person. One address is one person in a workspace: a second
 * person with the same one would make a Slack message or a mail somebody else's. The caller
 * holds the team lock, so two people cannot take one address at the same moment.
 */
export async function set_team_match_email(
  db: DatabaseExecutor,
  input: { workspace_id: string; user_id: string; match_email: string | null; actor_id: string },
): Promise<void> {
  const match_email = input.match_email?.trim().toLowerCase() || null;
  if (match_email) await refuse_an_address_of_another_person(db, { ...input, match_email });
  await db
    .update(users)
    .set({
      user_data: match_email
        ? sql`${users.user_data} || ${JSON.stringify({ [match_email_key]: match_email })}::jsonb`
        : sql`${users.user_data} - ${match_email_key}`,
      ...updated_by(input.actor_id),
    })
    .where(eq(users.user_id, input.user_id));
}

async function refuse_an_address_of_another_person(
  db: DatabaseExecutor,
  input: { workspace_id: string; user_id: string; match_email: string },
) {
  const [taken] = await db
    .select({ user_id: users.user_id })
    .from(workspace_members)
    .innerJoin(users, eq(users.user_id, workspace_members.user_id))
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        inArray(workspace_members.member_status, ['active', 'invited']),
        ne(users.user_id, input.user_id),
        sql`${team_match_email_of_user} = ${input.match_email}`,
      ),
    )
    .limit(1);
  if (taken) throw new ConflictError('Another person on this team already has this address.');
}

/**
 * The members a mail sender is matched against, each with the address to match. In team mode
 * that is the address a person gave for it, and a person who gave none is matched by nothing.
 * Everywhere else it is the address the person signs in with, as before.
 */
export async function list_members_to_match_by_email(db: DatabaseExecutor, workspace_id: string) {
  const members = await list_workspace_member_users(db, workspace_id);
  if (!is_team_mode_switched_on()) return members;
  const with_an_address = await db
    .select({ user_id: users.user_id, match_email: team_match_email_of_user })
    .from(workspace_members)
    .innerJoin(users, eq(users.user_id, workspace_members.user_id))
    .where(
      and(eq(workspace_members.workspace_id, workspace_id), isNotNull(team_match_email_of_user)),
    );
  const address_of = new Map(with_an_address.map((row) => [row.user_id, row.match_email]));
  return members.flatMap((member) => {
    const email = address_of.get(member.user_id);
    return email ? [{ ...member, email }] : [];
  });
}

/** In team mode a person is also found by the address they gave. Everywhere else, never. */
export function is_the_match_email_in_team_mode(email: string): SQL | undefined {
  if (!is_team_mode_switched_on()) return undefined;
  return sql`${team_match_email_of_user} = ${email.trim().toLowerCase()}`;
}
