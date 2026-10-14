import { type TeamRole, team_change_refusal } from '@api/services/team/team_change_refusal';
import {
  invitation_link_lifetime_ms,
  make_team_sign_in_link,
  member_link_lifetime_ms,
  type TeamSignInLink,
} from '@api/services/team/team_sign_in';
import { read_team_address } from '@coworker/config/local_mode_switch';
import type { Database, DatabaseExecutor } from '@coworker/core';
import {
  read_team_match_email,
  set_team_match_email,
} from '@coworker/core/db/queries/team_match_emails';
import {
  count_active_team_owners,
  create_invited_team_member,
  find_team_member,
  list_team_members,
  lock_team,
  set_team_member_name,
  set_team_member_role,
  type TeamMember,
} from '@coworker/core/db/queries/team_members';
import { delete_team_sessions_of_member } from '@coworker/core/db/queries/team_sessions';
import {
  clear_team_sign_in_notice,
  list_team_sign_ins,
  read_team_sign_in_notice,
} from '@coworker/core/db/queries/team_sign_in_notices';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { AppError, ConflictError, NotFoundError } from '@coworker/shared';

export type TeamActor = { workspace_id: string; actor_id: string };
export type TeamTarget = TeamActor & { user_id: string };

export async function list_team(db: Database, input: TeamActor) {
  const [members, viewer_role] = await Promise.all([
    list_team_members(db, input.workspace_id),
    find_actor_role(db, input),
  ]);
  return { viewer_user_id: input.actor_id, viewer_role, members, open_at: read_team_address() };
}

export async function invite_team_member(
  db: Database,
  input: TeamActor & { name: string; member_role: TeamRole; match_email?: string | undefined },
): Promise<{ member: TeamMember; sign_in_link: TeamSignInLink }> {
  return db.transaction(async (tx) => {
    await lock_team(tx, input.workspace_id);
    await authorize_team_change(tx, input, { next_role: input.member_role });
    const member = await create_invited_team_member(tx, { ...input, first_name: input.name });
    if (input.match_email) {
      await set_team_match_email(tx, {
        ...input,
        user_id: member.user_id,
        match_email: input.match_email,
      });
    }
    const sign_in_link = await make_team_sign_in_link(tx, {
      ...input,
      user_id: member.user_id,
      lifetime_ms: invitation_link_lifetime_ms,
    });
    return { member, sign_in_link };
  });
}

/**
 * An invited person gets two more days to join. A person who has joined gets one hour, and
 * using that link ends their earlier sessions: it is the lost-device button.
 */
export async function make_member_sign_in_link(
  db: Database,
  input: TeamTarget,
): Promise<TeamSignInLink> {
  return db.transaction(async (tx) => {
    await lock_team(tx, input.workspace_id);
    const member = await require_team_member(tx, input);
    const has_joined = member.member_status === 'active';
    await authorize_team_change(tx, input, {
      current_role: member.member_role,
      signs_in_as_a_joined_person: has_joined,
    });
    return make_team_sign_in_link(tx, {
      ...input,
      lifetime_ms: has_joined ? member_link_lifetime_ms : invitation_link_lifetime_ms,
    });
  });
}

export async function change_team_member_role(
  db: Database,
  input: TeamTarget & { member_role: TeamRole },
): Promise<TeamMember> {
  return db.transaction(async (tx) => {
    await lock_team(tx, input.workspace_id);
    const member = await require_team_member(tx, input);
    await authorize_team_change(tx, input, {
      current_role: member.member_role,
      next_role: input.member_role,
    });
    if (input.member_role !== 'owner') await refuse_to_lose_the_last_owner(tx, input, member);
    await set_team_member_role(tx, input);
    return { ...member, member_role: input.member_role };
  });
}

/** The signed-in person names themselves. No input says whose name it is, so it is never another person's. */
export async function set_own_name(db: Database, input: TeamActor & { name: string }) {
  await set_team_member_name(db, { user_id: input.actor_id, name: input.name });
  return { name: input.name };
}

/** Ends every session of the signed-in person, this one too: for a device they no longer trust. */
export async function sign_out_everywhere(db: Database, input: TeamActor): Promise<void> {
  await delete_team_sessions_of_member(db, { ...input, user_id: input.actor_id });
}

/**
 * What a person sees about their own account: the last times a link signed them in, and the
 * address they gave to be known by in Slack and in mail.
 */
export async function read_own_account(db: Database, input: TeamActor) {
  const [sign_ins, match_email] = await Promise.all([
    list_team_sign_ins(db, input.actor_id),
    read_team_match_email(db, input.actor_id),
  ]);
  return { sign_ins, match_email };
}

/**
 * A person sets, changes or clears their own address for Slack and mail, and nobody else's.
 * An owner or an admin can give one when they invite a person, and only then.
 */
export async function set_own_match_email(
  db: Database,
  input: TeamActor & { match_email: string | null },
) {
  await db.transaction(async (tx) => {
    await lock_team(tx, input.workspace_id);
    await set_team_match_email(tx, { ...input, user_id: input.actor_id });
  });
  return read_own_account(db, input);
}

/**
 * What the app needs when a person arrives: their role, and the notice about the sign-in
 * before this one. The notice stays until the page that showed it says so.
 */
export async function read_team_arrival(db: Database, input: TeamActor) {
  const [viewer_role, sign_in_notice] = await Promise.all([
    find_actor_role(db, input),
    read_team_sign_in_notice(db, input.actor_id),
  ]);
  return { viewer_role, sign_in_notice };
}

export async function mark_sign_in_notice_seen(db: Database, input: TeamActor): Promise<void> {
  await clear_team_sign_in_notice(db, input.actor_id);
}

export async function authorize_team_change(
  db: DatabaseExecutor,
  actor: TeamActor,
  change: Parameters<typeof team_change_refusal>[1],
) {
  const refusal = team_change_refusal(await find_actor_role(db, actor), change);
  if (refusal) throw new AppError('team_access_denied', refusal, 403);
}

function find_actor_role(db: DatabaseExecutor, actor: TeamActor) {
  return find_active_workspace_member_role(db, {
    workspace_id: actor.workspace_id,
    user_id: actor.actor_id,
  });
}

export async function require_team_member(
  db: DatabaseExecutor,
  input: TeamTarget,
): Promise<TeamMember> {
  const member = await find_team_member(db, input);
  if (!member) throw new NotFoundError('Team member');
  return member;
}

export async function refuse_to_lose_the_last_owner(
  db: DatabaseExecutor,
  input: TeamTarget,
  member: TeamMember,
) {
  if (member.member_role !== 'owner' || member.member_status !== 'active') return;
  if ((await count_active_team_owners(db, input.workspace_id)) > 1) return;
  throw new ConflictError(
    'A workspace needs at least one owner. Make someone else an owner first.',
  );
}
