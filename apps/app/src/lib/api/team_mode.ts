import { api_client, no_store_request, read_api_data } from '@/lib/api/client';
import type { TeamSignInNotice } from '@/lib/team_arrival';

const team = api_client.v1.team;

export type TeamRole = 'owner' | 'admin' | 'member';
export type TeamMember = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  member_role: string;
  member_status: string;
};
export type TeamAddress = {
  address: string;
  who_can_open: 'this_machine_only' | 'other_machines' | 'through_a_proxy_on_this_machine';
};
export type Team = {
  viewer_user_id: string;
  viewer_role: string | null;
  members: TeamMember[];
  open_at: TeamAddress;
};
export type TeamSignInLink = { token: string; expires_time: string };

export const team_query_key = ['team'] as const;
export const team_viewer_role_query_key = ['team_viewer_role'] as const;
export const chat_of_person_query_key = (session_id: string | undefined) =>
  ['team', 'chat_of_person', session_id] as const;

/** Asks for one chat. The API answers "not found" for a chat this person may not read. */
export async function read_chat_of_person(session_id: string) {
  return read_api_data(
    await api_client.v1.sessions[':session_id'].$get({ param: { session_id } }, no_store_request),
    { method: 'GET', path: `/v1/sessions/${session_id}` },
  );
}
export const team_member_connections_query_key = (user_id: string) =>
  ['team', 'member_connections', user_id] as const;

export async function read_team(): Promise<Team> {
  return read_api_data<Team>(await team.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/team',
  });
}

export async function invite_team_member(input: { name: string; role: TeamRole; email?: string }) {
  return read_api_data<{ member: TeamMember; sign_in_link: TeamSignInLink }>(
    await team.invitations.$post({ json: input }),
    { method: 'POST', path: '/v1/team/invitations' },
  );
}

export async function make_team_member_sign_in_link(user_id: string) {
  return read_api_data<TeamSignInLink>(
    await team.members[':user_id']['sign-in-link'].$post({ param: { user_id } }),
    { method: 'POST', path: `/v1/team/members/${user_id}/sign-in-link` },
  );
}

export async function set_team_member_role(input: { user_id: string; role: TeamRole }) {
  return read_api_data<TeamMember>(
    await team.members[':user_id'].$patch({
      param: { user_id: input.user_id },
      json: { role: input.role },
    }),
    { method: 'PATCH', path: `/v1/team/members/${input.user_id}` },
  );
}

export type MemberConnection = {
  connection_id: string;
  connection_name: string;
  also_used_by_user_ids: string[];
};

export type RemovedMemberSummary = {
  user_id: string;
  api_keys_revoked: number;
  scheduled_tasks_switched_off: string[];
  waiting_messages_cleared: number;
  runs_stopped: number;
  connections: (MemberConnection & { disconnected: boolean })[];
};

export async function list_team_member_connections(user_id: string) {
  const answer = await read_api_data<{ connections: MemberConnection[] }>(
    await team.members[':user_id'].connections.$get({ param: { user_id } }, no_store_request),
    { method: 'GET', path: `/v1/team/members/${user_id}/connections` },
  );
  return answer.connections;
}

export async function remove_team_member(input: { user_id: string; keeps_connections: boolean }) {
  return read_api_data<RemovedMemberSummary>(
    await team.members[':user_id'].$delete({
      param: { user_id: input.user_id },
      query: { keep_connections: input.keeps_connections ? 'true' : 'false' },
    }),
    { method: 'DELETE', path: `/v1/team/members/${input.user_id}` },
  );
}

export type OwnTeamAccount = { sign_ins: TeamSignInNotice[]; match_email: string | null };
export const own_team_account_query_key = ['team', 'me'] as const;

export async function read_own_team_account(): Promise<OwnTeamAccount> {
  return read_api_data<OwnTeamAccount>(await team.me.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/team/me',
  });
}

export async function set_own_match_email(match_email: string | null): Promise<OwnTeamAccount> {
  return read_api_data<OwnTeamAccount>(await team.me.$patch({ json: { match_email } }), {
    method: 'PATCH',
    path: '/v1/team/me',
  });
}

export async function mark_sign_in_notice_seen(): Promise<void> {
  await read_api_data(await team['sign-in-notice'].seen.$post(), {
    method: 'POST',
    path: '/v1/team/sign-in-notice/seen',
  });
}

export async function set_my_team_name(name: string): Promise<void> {
  await read_api_data(await team['my-name'].$put({ json: { name } }), {
    method: 'PUT',
    path: '/v1/team/my-name',
  });
}

export async function sign_out_everywhere(): Promise<void> {
  await read_api_data(await team['sign-out-everywhere'].$post(), {
    method: 'POST',
    path: '/v1/team/sign-out-everywhere',
  });
}
