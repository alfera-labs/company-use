import { read_api_origin } from '@coworker/config/api_origin';
import { fetch_through_tunnel, set_upstream_tunnel_headers } from '@/lib/api/upstream_tunnel';
import {
  resolve_workspace_proxy_secret,
  workspace_proxy_headers,
} from '@/lib/workspace_proxy_headers';

export type TeamLinkPreview = {
  workspace_name: string;
  person_name: string;
  has_joined_before: boolean;
};
export type TeamSession = { session_token: string; max_age_seconds: number };
export type TeamSessionPerson = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  organization_id: string;
};

/** Whose session a token is, or that its person was removed from the workspace, or nobody's. */
export type TeamSessionAnswer =
  | { person: TeamSessionPerson }
  | { removed_from_workspace: string }
  | null;

const statuses_that_mean_no = new Set([401, 404, 422]);
const code_of_a_removed_person = 'team_member_removed';

async function post_team_sign_in(path: string, body: Record<string, string>): Promise<Response> {
  const target = `${read_api_origin()}/v1/team-sign-in/${path}`;
  const headers = new Headers({ 'content-type': 'application/json' });
  set_upstream_tunnel_headers(headers, target);
  headers.set(workspace_proxy_headers.secret, resolve_workspace_proxy_secret());
  const response = await fetch_through_tunnel(
    target,
    { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' },
    { can_retry: false },
  );
  if (statuses_that_mean_no.has(response.status) || response.ok) return response;
  throw new Error(`Team sign-in ${path} answered ${response.status}`);
}

async function ask_team_sign_in<T>(path: string, body: Record<string, string>): Promise<T | null> {
  const response = await post_team_sign_in(path, body);
  if (!response.ok) return null;
  return ((await response.json()) as { data: T }).data;
}

type Refusal = { error?: { code?: string; details?: { workspace_name?: string } } };

async function read_removed_from_workspace(response: Response): Promise<string | null> {
  const refusal = (await response.json().catch(() => ({}))) as Refusal;
  if (refusal.error?.code !== code_of_a_removed_person) return null;
  return refusal.error.details?.workspace_name ?? '';
}

/**
 * Each call here asks the API as the app server itself, with the proxy secret and no person: a
 * browser with no session yet has nobody to ask as. Null is the API's "no" (a token that is
 * malformed, unknown, used or expired, or whose person was removed). An API that cannot answer
 * throws, so an outage never reads as "this session is over".
 */
export function preview_team_link(token: string) {
  return ask_team_sign_in<TeamLinkPreview>('link/preview', { token });
}

export function redeem_team_link(token: string) {
  return ask_team_sign_in<TeamSession>('link/redeem', { token });
}

export async function read_team_session(session_token: string): Promise<TeamSessionAnswer> {
  const response = await post_team_sign_in('session', { session_token });
  if (response.ok) return { person: ((await response.json()) as { data: TeamSessionPerson }).data };
  const removed_from_workspace = await read_removed_from_workspace(response);
  return removed_from_workspace === null ? null : { removed_from_workspace };
}

export async function end_team_session(session_token: string): Promise<void> {
  await ask_team_sign_in('session/end', { session_token });
}
