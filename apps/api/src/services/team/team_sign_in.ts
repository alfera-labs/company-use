import { create_team_secret, hash_team_secret } from '@api/services/team/team_secrets';
import { start_team_session, type TeamSession } from '@api/services/team/team_session_start';
import { local_mode_identity, read_local_user_name } from '@coworker/config/local_mode_switch';
import type { Database, DatabaseExecutor } from '@coworker/core';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import {
  activate_invited_team_member,
  find_team_member,
  lock_team,
} from '@coworker/core/db/queries/team_members';
import {
  delete_team_session,
  delete_team_sessions_of_member,
  find_team_session_member,
  find_workspace_a_session_was_removed_from,
} from '@coworker/core/db/queries/team_sessions';
import {
  create_team_sign_in_link,
  find_open_team_sign_in_link,
  use_team_sign_in_link,
} from '@coworker/core/db/queries/team_sign_in_links';
import {
  record_team_sign_in,
  type TeamSignIn,
} from '@coworker/core/db/queries/team_sign_in_notices';
import {
  find_first_team_owner,
  find_team_workspace,
} from '@coworker/core/db/queries/team_workspace';
import { get_user } from '@coworker/core/db/queries/users';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { format_person_name } from '@coworker/shared';

const one_hour_ms = 60 * 60 * 1000;
const one_day_ms = 24 * one_hour_ms;
export const invitation_link_lifetime_ms = 2 * one_day_ms;
export const member_link_lifetime_ms = one_hour_ms;
export const helper_actor = 'system:team_helper';
const name_of_the_helper = 'the command line of this server';

export type TeamSignInLink = { token: string; expires_time: string };
export type TeamSessionPerson = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  organization_id: string;
};

export async function make_team_sign_in_link(
  db: DatabaseExecutor,
  input: { workspace_id: string; user_id: string; actor_id: string; lifetime_ms: number },
): Promise<TeamSignInLink> {
  const { secret, secret_hash } = create_team_secret();
  const expires_time = new Date(Date.now() + input.lifetime_ms);
  await create_team_sign_in_link(db, { ...input, token_hash: secret_hash, expires_time });
  return { token: secret, expires_time: expires_time.toISOString() };
}

/** What the confirm page shows. Reading it uses nothing up, so a link preview cannot burn a link. */
export async function preview_team_sign_in_link(db: Database, token: string) {
  const link = await find_open_team_sign_in_link(db, hash_team_secret(token));
  if (!link) return null;
  return {
    workspace_name: link.workspace_name,
    person_name: format_person_name(link.first_name, link.last_name).trim(),
    has_joined_before: link.member_status === 'active',
  };
}

/**
 * Uses the link up and opens a session, or null when the link is not valid any more. It takes
 * the team lock before it touches the link, as removing a member does, so a removal and a
 * redemption of that member's link cannot interleave: the second one sees the first one's result.
 *
 * A link for a person who had signed in before is the lost-device button: every earlier session
 * of that person ends, so a stolen cookie or a lost laptop stops working. Whoever holds a link
 * is that person, so each use is kept in the person's list of sign-ins, and each sign-in is
 * told about the one before it. The session a link made is not the place to tell about that
 * same link: when somebody else used it, the person is signed out and sees it at their next
 * sign-in. A first sign-in (the installer's owner link, an invitation) has none before it.
 */
export async function redeem_team_sign_in_link(
  db: Database,
  token: string,
): Promise<TeamSession | null> {
  const token_hash = hash_team_secret(token);
  const open_link = await find_open_team_sign_in_link(db, token_hash);
  if (!open_link) return null;

  const signed_in = await db.transaction(async (tx) => {
    await lock_team(tx, open_link.workspace_id);
    const link = await use_team_sign_in_link(tx, token_hash);
    if (!link || !(await find_team_member(tx, link))) return null;
    const joins_now = await activate_invited_team_member(tx, link);
    const sign_in_before = await record_team_sign_in(tx, {
      user_id: link.user_id,
      sign_in: {
        used_time: new Date().toISOString(),
        made_by_name: await name_of_link_maker(tx, link.made_by),
        link_kind: kind_of_link(link.made_by, joins_now),
      },
    });
    if (sign_in_before) await delete_team_sessions_of_member(tx, link);
    return { member: link, session: await start_team_session(tx, link) };
  });
  if (!signed_in) return null;

  await open_personal_project(db, signed_in.member);
  return signed_in.session;
}

function kind_of_link(made_by: string, joins_now: boolean): TeamSignIn['link_kind'] {
  if (joins_now) return 'invitation';
  return made_by === helper_actor ? 'command_line' : 'new_link';
}

async function name_of_link_maker(db: DatabaseExecutor, made_by: string): Promise<string> {
  if (made_by === helper_actor) return name_of_the_helper;
  const maker = await get_user(db, made_by);
  return format_person_name(maker?.first_name, maker?.last_name, 'a person who has left');
}

/**
 * The person a session token belongs to, or null. A session ends 30 days after it was made and
 * nothing extends it, so a copied cookie cannot be kept alive by using it.
 */
export async function authenticate_team_session(
  db: Database,
  session_token: string,
): Promise<TeamSessionPerson | null> {
  const member = await find_team_session_member(db, hash_team_secret(session_token));
  if (!member) return null;
  return { ...member, organization_id: local_mode_identity.organization_id };
}

/**
 * The name of the workspace the holder of this session token was removed from, or null. It is
 * told only to a browser that holds the token of a session that was valid until the removal.
 */
export function find_workspace_session_was_removed_from(
  db: Database,
  session_token: string,
): Promise<string | null> {
  return find_workspace_a_session_was_removed_from(db, hash_team_secret(session_token));
}

export async function end_team_session(db: Database, session_token: string): Promise<void> {
  await delete_team_session(db, hash_team_secret(session_token));
}

/**
 * A link for the owner, for the person who runs the server: the first sign-in, and a new
 * browser or a lost device later. It lasts one hour unless the caller asks for less. An install
 * that never ran gets its workspace and owner here.
 */
export async function make_owner_sign_in_link(
  db: Database,
  lifetime_ms: number = member_link_lifetime_ms,
): Promise<TeamSignInLink> {
  const workspace = (await find_team_workspace(db)) ?? (await provision_the_local_workspace(db));
  const owner = await find_first_team_owner(db, workspace.workspace_id);
  if (!owner) throw new Error('This workspace has no active owner');
  return make_team_sign_in_link(db, {
    workspace_id: workspace.workspace_id,
    user_id: owner.user_id,
    actor_id: helper_actor,
    lifetime_ms,
  });
}

function provision_the_local_workspace(db: Database) {
  const first_name = read_local_user_name();
  return provision_workspace_for_identity(db, {
    ...local_mode_identity,
    ...(first_name ? { first_name } : {}),
  });
}
