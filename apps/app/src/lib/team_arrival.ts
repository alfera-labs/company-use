import { server_api_fetch } from '@/lib/server_api';
import { is_team_mode_on } from '@/lib/team_mode';

export type TeamSignInNotice = {
  made_by_name: string;
  used_time: string;
  link_kind: 'invitation' | 'command_line' | 'new_link';
};
export type TeamArrival = { viewer_role: string | null; sign_in_notice: TeamSignInNotice | null };

const not_a_team_install: TeamArrival = { viewer_role: null, sign_in_notice: null };

/**
 * What the app learns when a person of a team-mode install opens it: their role, and the
 * notice that a new sign-in link was used for their account, until a page has shown it.
 * Every other install answers "no role, no notice" without asking the API.
 */
export async function read_team_arrival(): Promise<TeamArrival> {
  if (!is_team_mode_on()) return not_a_team_install;
  const response = await server_api_fetch('/v1/team/arrival', { method: 'POST' });
  if (!response.ok) return not_a_team_install;
  const arrival = (await response.json()) as { data?: Partial<TeamArrival> };
  return {
    viewer_role: arrival.data?.viewer_role ?? null,
    sign_in_notice: arrival.data?.sign_in_notice ?? null,
  };
}

/**
 * Onboarding sets the workspace up, so in team mode it is the owner's job. A person who joined
 * by a link goes straight to their own chats, whether or not the owner has finished it.
 */
export function is_onboarding_this_persons_job(arrival: TeamArrival): boolean {
  return !is_team_mode_on() || arrival.viewer_role === 'owner';
}
