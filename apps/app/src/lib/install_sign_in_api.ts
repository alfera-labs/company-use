import { read_api_origin } from '@coworker/config/api_origin';
import { fetch_through_tunnel, set_upstream_tunnel_headers } from '@/lib/api/upstream_tunnel';
import { set_client_ip_header } from '@/lib/api_proxy';
import { is_write_from_own_page } from '@/lib/same_origin_request';
import { is_team_mode_on, read_team_session_token, team_session_cookie } from '@/lib/team_mode';
import { end_team_session } from '@/lib/team_sign_in_api';
import {
  resolve_workspace_proxy_secret,
  workspace_proxy_headers,
} from '@/lib/workspace_proxy_headers';

type InstallSignInStep = { api_path: string; method: 'GET' | 'POST'; opens_session: boolean };

/**
 * The calls the setup page and the sign-in page make before anybody is signed in. The browser
 * names a step; the app server calls the API with the proxy secret, so the API is never asked
 * as a person. A step that opens a session sets the session cookie, and the session token never
 * reaches the page.
 */
export const install_sign_in_steps = {
  'setup/check': { api_path: '/v1/setup/check', method: 'POST', opens_session: false },
  'setup/ai-key': { api_path: '/v1/setup/ai-key', method: 'POST', opens_session: false },
  'setup/chatgpt-start': {
    api_path: '/v1/setup/chatgpt/start',
    method: 'POST',
    opens_session: false,
  },
  'setup/chatgpt-finish': {
    api_path: '/v1/setup/chatgpt/finish',
    method: 'POST',
    opens_session: false,
  },
  'setup/owner': { api_path: '/v1/setup/owner', method: 'POST', opens_session: true },
  'password/state': {
    api_path: '/v1/team-sign-in/password/state',
    method: 'GET',
    opens_session: false,
  },
  'password/sign-in': {
    api_path: '/v1/team-sign-in/password',
    method: 'POST',
    opens_session: true,
  },
  'password/recover': {
    api_path: '/v1/team-sign-in/password/recover',
    method: 'POST',
    opens_session: true,
  },
} as const satisfies Record<string, InstallSignInStep>;

const largest_body_bytes = 16_384;
const no_store = { 'Cache-Control': 'no-store' };

type ApiAnswer = { data?: Record<string, unknown>; error?: { code?: string; message?: string } };

function plain_answer(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: no_store });
}

async function ask_api(step: InstallSignInStep, body: string | null, incoming?: Request) {
  const target = `${read_api_origin()}${step.api_path}`;
  const headers = new Headers({ 'content-type': 'application/json' });
  set_upstream_tunnel_headers(headers, target);
  headers.set(workspace_proxy_headers.secret, resolve_workspace_proxy_secret());
  if (incoming) set_client_ip_header(headers, incoming);
  const response = await fetch_through_tunnel(
    target,
    { method: step.method, headers, ...(body === null ? {} : { body }), cache: 'no-store' },
    { can_retry: false },
  );
  const answer = (await response.json().catch(() => ({}))) as ApiAnswer;
  return { status: response.status, answer };
}

async function answer_with_session(request: Request, status: number, answer: ApiAnswer) {
  const { session_token, max_age_seconds, ...rest } = answer.data ?? {};
  const earlier_session_token = read_team_session_token(request);
  if (earlier_session_token) await end_team_session(earlier_session_token);
  const response = Response.json({ data: rest }, { status, headers: no_store });
  response.headers.append(
    'Set-Cookie',
    team_session_cookie(request, String(session_token), Number(max_age_seconds)),
  );
  return response;
}

export async function forward_install_sign_in_step(
  request: Request,
  step_name: string,
): Promise<Response> {
  const step = install_sign_in_steps[step_name as keyof typeof install_sign_in_steps];
  if (!is_team_mode_on() || !step || request.method !== step.method) {
    return plain_answer(404, 'not_found', 'This page does not exist.');
  }
  if (step.method === 'POST' && !is_write_from_own_page(request)) {
    return plain_answer(403, 'forbidden', 'This only works from this site.');
  }
  const body = step.method === 'POST' ? await request.text() : null;
  if (body !== null && body.length > largest_body_bytes) {
    return plain_answer(413, 'too_large', 'This request is too large.');
  }
  const { status, answer } = await ask_api(step, body, request);
  const opened_a_session = step.opens_session && status < 300 && answer.data?.session_token;
  if (opened_a_session) return answer_with_session(request, status, answer);
  return Response.json(answer, { status, headers: no_store });
}

export type InstallSignInState = { owner_password_is_set: boolean; setup_is_waiting: boolean };

export async function read_install_sign_in_state(): Promise<InstallSignInState> {
  const { status, answer } = await ask_api(install_sign_in_steps['password/state'], null);
  if (status !== 200) throw new Error(`Sign-in state answered ${status}`);
  return {
    owner_password_is_set: answer.data?.owner_password_is_set === true,
    setup_is_waiting: answer.data?.setup_is_waiting === true,
  };
}
