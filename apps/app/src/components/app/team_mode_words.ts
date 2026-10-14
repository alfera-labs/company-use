import { format_person_name } from '@coworker/shared';
import type { RemovedMemberSummary, TeamAddress, TeamMember, TeamRole } from '@/lib/api/team_mode';

export const team_role_words: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function team_member_name(member: TeamMember) {
  return format_person_name(member.first_name, member.last_name, 'No name');
}

/**
 * The roles this viewer may give. It mirrors the rule the server enforces, only to hide what
 * would be refused: an owner gives any role, an admin invites members.
 */
export function roles_the_viewer_may_give(viewer_role: string | null): TeamRole[] {
  if (viewer_role === 'owner') return ['member', 'admin', 'owner'];
  if (viewer_role === 'admin') return ['member'];
  return [];
}

/** An owner manages anyone. An admin manages plain members. */
export function viewer_may_manage(viewer_role: string | null, member: TeamMember) {
  return viewer_role === 'owner' || (viewer_role === 'admin' && member.member_role === 'member');
}

/**
 * True for the one owner who has joined. The server keeps that seat and that role, so the page
 * offers neither change. An owner who is only invited does not count yet.
 */
export function is_the_only_owner(member: TeamMember, all_members: TeamMember[]) {
  const has_joined_as_owner = (one: TeamMember) =>
    one.member_role === 'owner' && one.member_status === 'active';
  return has_joined_as_owner(member) && all_members.filter(has_joined_as_owner).length === 1;
}

export const only_owner_stays_words =
  'The only owner cannot be removed or given another role. Make someone else an owner first.';

/**
 * Whoever opens a sign-in link is that person. So only an owner makes one for a person who has
 * joined; an admin makes one for a person who has not joined yet.
 */
export function viewer_may_make_a_link(viewer_role: string | null, member: TeamMember) {
  if (!viewer_may_manage(viewer_role, member)) return false;
  return viewer_role === 'owner' || member.member_status !== 'active';
}

/** One line for the remover: what else was switched off with the person. */
export function removal_summary_words(name: string, removed: RemovedMemberSummary) {
  const tasks = removed.scheduled_tasks_switched_off;
  const disconnected = removed.connections.filter((connection) => connection.disconnected);
  const still_connected = removed.connections.filter((connection) => !connection.disconnected);
  const names_of = (connections: { connection_name: string }[]) =>
    connections.map((connection) => connection.connection_name).join(', ');
  const switched_off = [
    removed.api_keys_revoked > 0 ? `${counted(removed.api_keys_revoked, 'API key')} revoked` : '',
    tasks.length > 0
      ? `${counted(tasks.length, 'scheduled task')} switched off (${tasks.join(', ')})`
      : '',
    removed.waiting_messages_cleared > 0
      ? `${counted(removed.waiting_messages_cleared, 'waiting message')} taken back`
      : '',
    removed.runs_stopped > 0 ? `${counted(removed.runs_stopped, 'running chat')} stopped` : '',
    disconnected.length > 0 ? `disconnected: ${names_of(disconnected)}` : '',
    still_connected.length > 0 ? `STILL CONNECTED: ${names_of(still_connected)}` : '',
  ].filter(Boolean);
  const also = switched_off.length > 0 ? ` Also: ${switched_off.join('; ')}.` : '';
  return `${name} is removed and signed out.${also}`;
}

function counted(count: number, thing: string) {
  return `${count} ${thing}${count === 1 ? '' : 's'}`;
}

/** What members share, said where a person is invited: the one fact to know before inviting. */
export const what_members_share_words =
  "Every member's coworker reads and writes the same workspace folder: files, skills, notes, tasks and saved tool output. So one member can change what another member's coworker does, and can read what the coworker saved there for the others. Private chats do not protect against a member you do not trust: invite only people you trust with that.";

/**
 * Where people open this install, said as it really is. The address is the one the install
 * was set up with, not the one this page happens to be open at: a link is made for it. Who can
 * open it there is the API's answer, the one `./alfera status` and `./alfera doctor` give too.
 */
export function where_people_open_it_words(open_at: TeamAddress): string {
  if (open_at.who_can_open === 'this_machine_only') {
    return `Only this machine can open this Alfera now, at ${open_at.address}. To let other people in, run ./alfera add team in the install folder. Sign-in links made before that work on this machine only.`;
  }
  const how_it_is_reached =
    open_at.who_can_open === 'other_machines'
      ? 'Other machines that can reach that address can open it.'
      : 'Its port is published on this machine only, so that address must be a proxy or a tunnel on this machine.';
  return `People open this Alfera at ${open_at.address}, and every sign-in link is made for that address. ${how_it_is_reached}`;
}

/** Where a person opens the link: the address the install was set up with. */
export function sign_in_link_address(open_at: TeamAddress, token: string) {
  return `${open_at.address}/join/${token}`;
}
